<script lang="ts">
	import type { Feed, FeedUpdate } from '$lib/types';
	import { X } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { apiCall } from '$lib/api';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { storageGet, storageSet } from '$lib/storage';
	import {
		isRssBridgeUrl,
		parseRssBridgeUrl,
		buildRssBridgeUrl,
		RSS_BRIDGE_STORAGE_PREFIX,
		type RssBridgeConfig,
		type RssBridgeParam
	} from '$lib/rssbridge';
	import { COVER_STORAGE_PREFIX, asCoverRule } from '$lib/cover';
	import { NEW_CATEGORY_SENTINEL } from '$lib/category';
	import FeedGeneralSection from './feed-settings/FeedGeneralSection.svelte';
	import FeedNetworkSection from './feed-settings/FeedNetworkSection.svelte';
	import FeedRssBridgeSection from './feed-settings/FeedRssBridgeSection.svelte';
	import FeedOriginalContentSection from './feed-settings/FeedOriginalContentSection.svelte';
	import FeedCoverImageSection from './feed-settings/FeedCoverImageSection.svelte';
	import FeedDangerZoneSection from './feed-settings/FeedDangerZoneSection.svelte';

	let { feed }: { feed: Feed } = $props();

	let newCategoryName = $state('');

	const navItems = [
		{ id: 'general', label: 'General' },
		{ id: 'network', label: 'Network Settings' },
		{ id: 'rss-bridge', label: 'RSS-Bridge' },
		{ id: 'original-content', label: 'Original Content' },
		{ id: 'cover-image', label: 'Cover Image' },
		{ id: 'danger-zone', label: 'Danger Zone' }
	];
	let activeSection = $state('general');

	function goBack() {
		history.back();
	}

	// Capture initial values — the screen is keyed by feed id upstream so props are stable.
	// svelte-ignore state_referenced_locally
	const initial = {
		title: feed.title,
		site_url: feed.site_url,
		feed_url: feed.feed_url,
		category_id: feed.category.id,
		crawler: feed.crawler ?? false,
		scraper_rules: feed.scraper_rules ?? '',
		rewrite_rules: feed.rewrite_rules ?? '',
		disabled: feed.disabled ?? false,
		ignore_http_cache: feed.ignore_http_cache ?? false,
		user_agent: feed.user_agent ?? ''
	};
	let title = $state(initial.title);
	let siteUrl = $state(initial.site_url);
	let categoryId = $state(initial.category_id);
	let crawler = $state(initial.crawler);
	let scraperRules = $state(initial.scraper_rules);
	let rewriteRules = $state(initial.rewrite_rules);
	let disabled = $state(initial.disabled);
	let ignoreHttpCache = $state(initial.ignore_http_cache);
	let userAgent = $state(initial.user_agent);

	// --- RSS-Bridge block -------------------------------------------------------------
	// The feed's URL may be an RSS-Bridge wrapper. We decompose it into editable parts and
	// let the user toggle the bridge off (→ feed_url becomes the bare Source URL). While off,
	// the bridge params have nowhere to live in feed_url, so we keep them in localStorage.
	// svelte-ignore state_referenced_locally
	const rssKey = RSS_BRIDGE_STORAGE_PREFIX + feed.id;

	// svelte-ignore state_referenced_locally
	const rss0 = ((): { enabled: boolean } & RssBridgeConfig => {
		if (isRssBridgeUrl(feed.feed_url)) {
			const cfg = parseRssBridgeUrl(feed.feed_url)!;
			storageSet(rssKey, cfg); // keep the saved copy fresh
			return { enabled: true, ...cfg };
		}
		const saved = storageGet<RssBridgeConfig | null>(rssKey, null);
		return {
			enabled: false,
			instance: saved?.instance || 'https://rssbridge.de/',
			bridge: saved?.bridge || '',
			sourceUrl: feed.feed_url,
			params: saved?.params ?? []
		};
	})();

	let rssEnabled = $state(rss0.enabled);
	let rssInstance = $state(rss0.instance);
	let rssBridge = $state(rss0.bridge);
	let rssSourceUrl = $state(rss0.sourceUrl);
	// Fixed per feed — a bridge either wraps a feed (`url`) or scrapes a page (`home_page`).
	const rssSourceKey = rss0.sourceKey ?? 'url';
	let rssParams = $state<RssBridgeParam[]>(rss0.params);

	// The feed_url actually sent to Miniflux: the assembled bridge URL when on, else direct.
	const effectiveFeedUrl = $derived(
		rssEnabled
			? buildRssBridgeUrl({
					instance: rssInstance,
					bridge: rssBridge,
					sourceUrl: rssSourceUrl,
					sourceKey: rssSourceKey,
					params: rssParams
				})
			: rssSourceUrl
	);

	// Disabled-state edits to params/instance/bridge don't change effectiveFeedUrl, so track a
	// serialized signature to still flag them dirty and persist them to localStorage.
	const rssSignature = $derived(
		JSON.stringify({ rssEnabled, rssInstance, rssBridge, rssSourceUrl, rssParams })
	);
	let initialRssSignature = $state(
		JSON.stringify({
			rssEnabled: rss0.enabled,
			rssInstance: rss0.instance,
			rssBridge: rss0.bridge,
			rssSourceUrl: rss0.sourceUrl,
			rssParams: rss0.params
		})
	);

	// --- Cover image rule (client-side, per feed, localStorage) ------------------------
	// CSS selector (+ optional attribute) to extract the cover from the source page when the
	// generic og:image heuristic misses it (e.g. rutracker: selector "var.postImg", attr "title").
	// svelte-ignore state_referenced_locally
	const coverKey = COVER_STORAGE_PREFIX + feed.id;
	const cover0 = asCoverRule(storageGet<unknown>(coverKey, null));
	let coverSelector = $state(cover0.selector);
	let coverAttr = $state(cover0.attr);
	let initialCoverSelector = $state(cover0.selector);
	let initialCoverAttr = $state(cover0.attr);

	let saving = $state(false);
	let savedAt = $state(0);
	let refetching = $state(false);
	let refetchCount = $state(25);
	let refetchStatus = $state<'unread' | 'all'>(entries.showAll ? 'all' : 'unread');
	let progress = $state({ done: 0, total: 0 });

	// Read-only stats
	let entryCount = $state<number | null>(null);

	onMount(async () => {
		try {
			const res = await apiCall<{ total: number }>(`feeds/${feed.id}/entries?limit=1`);
			entryCount = res.total;
		} catch {
			// stats are best-effort
		}
	});

	const dirty = $derived(
		title !== initial.title ||
		siteUrl !== initial.site_url ||
		effectiveFeedUrl !== initial.feed_url ||
		rssSignature !== initialRssSignature ||
		coverSelector !== initialCoverSelector ||
		coverAttr !== initialCoverAttr ||
		categoryId !== initial.category_id ||
		crawler !== initial.crawler ||
		scraperRules !== initial.scraper_rules ||
		rewriteRules !== initial.rewrite_rules ||
		disabled !== initial.disabled ||
		ignoreHttpCache !== initial.ignore_http_cache ||
		userAgent !== initial.user_agent
	);

	function computeChanges(): FeedUpdate {
		const changes: FeedUpdate = {};
		if (title !== initial.title) changes.title = title;
		if (siteUrl !== initial.site_url) changes.site_url = siteUrl;
		if (effectiveFeedUrl !== initial.feed_url) changes.feed_url = effectiveFeedUrl;
		if (categoryId !== initial.category_id && categoryId !== NEW_CATEGORY_SENTINEL)
			changes.category_id = categoryId;
		if (crawler !== initial.crawler) changes.crawler = crawler;
		if (scraperRules !== initial.scraper_rules) changes.scraper_rules = scraperRules;
		if (rewriteRules !== initial.rewrite_rules) changes.rewrite_rules = rewriteRules;
		if (disabled !== initial.disabled) changes.disabled = disabled;
		if (ignoreHttpCache !== initial.ignore_http_cache) changes.ignore_http_cache = ignoreHttpCache;
		if (userAgent !== initial.user_agent) changes.user_agent = userAgent;
		return changes;
	}

	// Persist current form state and reset the baseline so dirty/Re-fetch see no pending changes.
	async function persistChanges(changes: FeedUpdate) {
		if (Object.keys(changes).length > 0) await feeds.updateFeed(feed.id, changes);
		// Always save the RSS-Bridge config — disabled-state param edits don't touch feed_url.
		const rssConfig: RssBridgeConfig = {
			instance: rssInstance,
			bridge: rssBridge,
			sourceUrl: rssSourceUrl,
			sourceKey: rssSourceKey,
			params: rssParams
		};
		storageSet(rssKey, rssConfig);
		storageSet(coverKey, { selector: coverSelector, attr: coverAttr });
		initialCoverSelector = coverSelector;
		initialCoverAttr = coverAttr;
		Object.assign(initial, {
			title,
			site_url: siteUrl,
			feed_url: effectiveFeedUrl,
			category_id: categoryId,
			crawler,
			scraper_rules: scraperRules,
			rewrite_rules: rewriteRules,
			disabled,
			ignore_http_cache: ignoreHttpCache,
			user_agent: userAgent
		});
		initialRssSignature = rssSignature;
	}

	// The assistant persists its rules to the feed itself (so it can preview them),
	// so applying just mirrors them into the form and resets the baseline.
	function applyAiRules(rules: { scraper_rules: string; rewrite_rules: string; crawler: boolean }) {
		scraperRules = rules.scraper_rules;
		rewriteRules = rules.rewrite_rules;
		crawler = rules.crawler;
		initial.scraper_rules = scraperRules;
		initial.rewrite_rules = rewriteRules;
		initial.crawler = crawler;
	}

	async function handleSave() {
		if (categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim()) return;
		saving = true;
		try {
			// Resolve a pending "＋ New category…" into a real category before diffing.
			if (categoryId === NEW_CATEGORY_SENTINEL) {
				categoryId = (await feeds.createCategory(newCategoryName.trim())).id;
				newCategoryName = '';
			}
			const changes = computeChanges();
			if (
				Object.keys(changes).length === 0 &&
				rssSignature === initialRssSignature &&
				coverSelector === initialCoverSelector &&
				coverAttr === initialCoverAttr
			)
				return;
			await persistChanges(changes);
			savedAt = Date.now();
			ui.showSuccess('Feed settings saved.');
		} catch {
			// Error shown by store
		} finally {
			saving = false;
		}
	}

	async function refetchLatest() {
		refetching = true;
		try {
			// Apply any pending changes first so the re-fetch uses the current rules.
			const changes = computeChanges();
			if (Object.keys(changes).length > 0) await persistChanges(changes);

			const res = await entries.refetchFeedLatest(feed.id, refetchCount, refetchStatus, (done, total) => {
				progress = { done, total };
			});
			const scope = refetchStatus === 'unread' ? 'unread ' : '';
			if (res.failed) {
				// Show the real reason (shared by most failures), not just a count. Full
				// per-entry detail is logged to the console by refetchFeedLatest.
				const reason = res.errors[0]?.message ?? 'unknown error';
				ui.showError(
					`Re-fetched ${res.ok}/${res.total} ${scope}entries — ${res.failed} failed: ${reason}`
				);
			} else {
				ui.showSuccess(`Re-fetched ${res.ok}/${res.total} ${scope}entries.`);
			}
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to re-fetch content');
		} finally {
			refetching = false;
			progress = { done: 0, total: 0 };
		}
	}

</script>

<!-- Close button, fixed to the top-right corner of the main scroll region -->
<button
	type="button"
	onclick={goBack}
	title="Close"
	aria-label="Close"
	class="fixed right-4 md:right-6 top-14 z-30 rounded-full p-1.75 text-n-700 bg-surface hover:bg-n-100 shadow-md hover:text-n-900"
>
	<X class="size-6.5" />
</button>

<div class="flex flex-col md:flex-row w-full max-w-5xl gap-6 py-6 sm:px-6">
	<!-- Section navigation: sidebar on desktop, horizontal tabs on mobile -->
	<nav class="w-full shrink-0 md:w-44">
		<div class="md:sticky md:top-4">
			<h2 class="mb-4 px-3 text-lg font-semibold text-n-800 max-md:hidden">Edit Feed</h2>
			<ul class="flex gap-1 overflow-x-auto md:flex-col max-md:pb-1">
			{#each navItems as item (item.id)}
				<li class="shrink-0">
					<button
						type="button"
						onclick={() => (activeSection = item.id)}
						class={`w-full whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
							activeSection === item.id
								? 'bg-n-100 font-medium text-a-700'
								: 'text-n-600 hover:bg-n-100'
						}`}
					>
						{item.label}
					</button>
				</li>
			{/each}
			</ul>
		</div>
	</nav>

	<!-- Sections: only the active one is shown -->
	<div class="min-w-0 flex-1 max-w-170 max-md:px-2">
		<FeedGeneralSection
			active={activeSection === 'general'}
			{feed}
			{entryCount}
			bind:title
			bind:categoryId
			bind:newCategoryName
			bind:siteUrl
			bind:rssSourceUrl
			{rssEnabled}
			{effectiveFeedUrl}
		/>

		<FeedNetworkSection
			active={activeSection === 'network'}
			bind:userAgent
			bind:disabled
			bind:ignoreHttpCache
		/>

		<FeedRssBridgeSection
			active={activeSection === 'rss-bridge'}
			bind:rssEnabled
			bind:rssInstance
			bind:rssBridge
			bind:rssSourceUrl
			bind:rssParams
			{rssSourceKey}
		/>

		<FeedOriginalContentSection
			active={activeSection === 'original-content'}
			{feed}
			bind:crawler
			bind:scraperRules
			bind:rewriteRules
			bind:refetchCount
			bind:refetchStatus
			{refetching}
			{progress}
			onRefetch={refetchLatest}
			onApplyAiRules={applyAiRules}
		/>

		<FeedCoverImageSection
			active={activeSection === 'cover-image'}
			bind:coverSelector
			bind:coverAttr
		/>

		<FeedDangerZoneSection active={activeSection === 'danger-zone'} {feed} />


		<!-- Save bar: sits directly below the active section -->
		<div class="mt-6 flex max-w-fit items-center gap-3">
			{#if savedAt && !dirty}
				<span class="text-sm text-n-500">Saved</span>
			{/if}
			<button
				type="button"
				onclick={handleSave}
				disabled={saving || !dirty || (categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim())}
				class="rounded-md bg-a-600 px-4 py-2 text-sm text-on-accent hover:bg-a-700 disabled:opacity-50"
			>
				{saving ? 'Saving…' : 'Save'}
			</button>
			<button
				type="button"
				onclick={goBack}
				class="rounded-md px-4 py-2 text-sm text-n-600 bg-n-100 hover:bg-n-200"
			>
				Cancel
			</button>
		</div>
	</div>
</div>
