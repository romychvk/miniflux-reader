<script lang="ts">
	import type { Feed, FeedUpdate } from '$lib/types';
	import {
		SlidersHorizontal,
		Globe,
		Link,
		FileText,
		Image,
		Database,
		Trash2
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { backend, caps } from '$lib/backend';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { storageGet, storageSet } from '$lib/storage';
	import {
		isRssBridgeUrl,
		parseRssBridgeUrl,
		buildRssBridgeUrl,
		defaultInstance,
		RSS_BRIDGE_STORAGE_PREFIX,
		type RssBridgeConfig,
		type RssBridgeParam
	} from '$lib/rssbridge';
	import { COVER_STORAGE_PREFIX, asCoverRule } from '$lib/cover';
	import { ARCHIVE_STORAGE_PREFIX } from '$lib/imageArchive';
	import { NEW_CATEGORY_SENTINEL } from '$lib/category';
	import {
		parsePageFeedUrl,
		pageFeedConfigKey,
		type PageFeedConfig,
		type PageFeedSigned
	} from '$lib/pageFeed';
	import FeedGeneralSection from './feed-settings/FeedGeneralSection.svelte';
	import FeedNetworkSection from './feed-settings/FeedNetworkSection.svelte';
	import FeedRssBridgeSection from './feed-settings/FeedRssBridgeSection.svelte';
	import FeedPageFeedSection from './feed-settings/FeedPageFeedSection.svelte';
	import FeedOriginalContentSection from './feed-settings/FeedOriginalContentSection.svelte';
	import FeedCoverImageSection from './feed-settings/FeedCoverImageSection.svelte';
	import FeedImageArchiveSection from './feed-settings/FeedImageArchiveSection.svelte';
	import FeedDangerZoneSection from './feed-settings/FeedDangerZoneSection.svelte';

	let { feed }: { feed: Feed } = $props();

	let newCategoryName = $state('');

	// --- Page feed (Miniflux Reader-generated from a listing page; the signed URL *is* the config) ----
	// Constant per instance: the screen is keyed by feed id upstream. A page feed shows its own
	// tab in place of RSS-Bridge — the two don't convert into each other.
	// svelte-ignore state_referenced_locally
	const pageFeed0 = parsePageFeedUrl(feed.feed_url);
	const isPageFeed = pageFeed0 !== null;

	const navItems = [
		{ id: 'general', label: 'General', icon: SlidersHorizontal },
		{ id: 'network', label: 'Network Settings', icon: Globe },
		isPageFeed ? { id: 'page-feed', label: 'Page Feed', icon: Link }
		: caps().rssBridge ? { id: 'rss-bridge', label: 'RSS-Bridge', icon: Link }
		: null,
		{ id: 'original-content', label: 'Original Content', icon: FileText },
		{ id: 'cover-image', label: 'Cover Image', icon: Image },
		{ id: 'image-archive', label: 'Image Archive', icon: Database },
		{ id: 'danger-zone', label: 'Danger Zone', icon: Trash2 }
	].filter((item) => item !== null);
	let activeSection = $state('general');

	// Capture initial values — the screen is keyed by feed id upstream so props are stable.
	// Reactive: Save moves this baseline, and `dirty` has to see it move.
	// svelte-ignore state_referenced_locally
	const initial = $state({
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
	});
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
			instance: saved?.instance || defaultInstance(),
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

	let pageFeedConfig = $state<PageFeedConfig>(pageFeed0 ?? { pageUrl: '', itemSelector: '' });
	let initialPageFeedKey = $state(pageFeedConfigKey(pageFeed0));
	// What Discard puts back; moves with the baseline on save.
	// svelte-ignore state_referenced_locally
	let pageFeedBaseline = $state.raw<PageFeedConfig>($state.snapshot(pageFeedConfig));
	// Set by FeedPageFeedSection after a successful server preview: the signed URL for that config.
	let pageFeedSigned = $state<PageFeedSigned | null>(null);

	// The feed_url actually sent to Miniflux: the assembled bridge URL when on, else direct.
	// buildRssBridgeUrl throws when no instance is known (neither the field nor a remembered
	// one); '' then means "not buildable" — Save stays disabled until an instance is entered.
	// Page feeds: a fresh signature wins (it also re-signs after a key rotation), an untouched
	// config keeps the stored URL, and an edited-but-not-previewed one isn't buildable yet.
	const effectiveFeedUrl = $derived.by(() => {
		if (isPageFeed) {
			const key = pageFeedConfigKey(pageFeedConfig);
			if (pageFeedSigned?.key === key) return pageFeedSigned.feedUrl;
			if (key === initialPageFeedKey) return initial.feed_url;
			return '';
		}
		if (!rssEnabled) return rssSourceUrl;
		try {
			return buildRssBridgeUrl({
				instance: rssInstance,
				bridge: rssBridge,
				sourceUrl: rssSourceUrl,
				sourceKey: rssSourceKey,
				params: rssParams
			});
		} catch {
			return '';
		}
	});

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
	// generic og:image heuristic misses it (e.g. a forum feed: selector "var.postImg", attr "title").
	// svelte-ignore state_referenced_locally
	const coverKey = COVER_STORAGE_PREFIX + feed.id;
	const cover0 = asCoverRule(storageGet<unknown>(coverKey, null));
	let coverSelector = $state(cover0.selector);
	let coverAttr = $state(cover0.attr);
	let initialCoverSelector = $state(cover0.selector);
	let initialCoverAttr = $state(cover0.attr);

	// --- Image archive (client-side, per feed, localStorage) --------------------------
	// Whether this feed's images are downloaded to our own server as entries arrive, instead of
	// being hotlinked from the source on every view. See $lib/imageArchive.
	// svelte-ignore state_referenced_locally
	const archiveKey = ARCHIVE_STORAGE_PREFIX + feed.id;
	const archive0 = storageGet<boolean>(archiveKey, false) === true;
	let archiveImages = $state(archive0);
	let initialArchiveImages = $state(archive0);

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
			const res = await backend().listEntries({ kind: 'feed', id: feed.id }, { limit: 1 });
			entryCount = res.total;
		} catch {
			// stats are best-effort
		}
	});

	// Which sections hold the pending changes — named in the status beside Save/Discard. The
	// overall `dirty` below stays the source of truth; this only labels it.
	const dirtySections = $derived.by(() => {
		const d = new Set<string>();
		const rss = JSON.parse(initialRssSignature);
		// The Source URL is edited in General while the bridge is off, in RSS-Bridge while it is on.
		const sourceChanged = rssSourceUrl !== rss.rssSourceUrl;
		if (
			title !== initial.title ||
			siteUrl !== initial.site_url ||
			categoryId !== initial.category_id ||
			(!isPageFeed && !rssEnabled && sourceChanged)
		)
			d.add('general');
		if (userAgent !== initial.user_agent || disabled !== initial.disabled || ignoreHttpCache !== initial.ignore_http_cache)
			d.add('network');
		if (isPageFeed) {
			if (pageFeedConfigKey(pageFeedConfig) !== initialPageFeedKey) d.add('page-feed');
		} else if (
			rssEnabled !== rss.rssEnabled ||
			rssInstance !== rss.rssInstance ||
			rssBridge !== rss.rssBridge ||
			JSON.stringify(rssParams) !== JSON.stringify(rss.rssParams) ||
			(rssEnabled && sourceChanged)
		)
			d.add('rss-bridge');
		if (crawler !== initial.crawler || scraperRules !== initial.scraper_rules || rewriteRules !== initial.rewrite_rules)
			d.add('original-content');
		if (coverSelector !== initialCoverSelector || coverAttr !== initialCoverAttr) d.add('cover-image');
		if (archiveImages !== initialArchiveImages) d.add('image-archive');
		return d;
	});

	const dirty = $derived(
		title !== initial.title ||
		siteUrl !== initial.site_url ||
		effectiveFeedUrl !== initial.feed_url ||
		rssSignature !== initialRssSignature ||
		coverSelector !== initialCoverSelector ||
		coverAttr !== initialCoverAttr ||
		archiveImages !== initialArchiveImages ||
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
		if (effectiveFeedUrl && effectiveFeedUrl !== initial.feed_url) changes.feed_url = effectiveFeedUrl;
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
		// (Not for page feeds: their URL is the config, and a bridge entry would be bogus.)
		if (!isPageFeed) {
			const rssConfig: RssBridgeConfig = {
				instance: rssInstance,
				bridge: rssBridge,
				sourceUrl: rssSourceUrl,
				sourceKey: rssSourceKey,
				params: rssParams
			};
			storageSet(rssKey, rssConfig);
		}
		storageSet(coverKey, { selector: coverSelector, attr: coverAttr });
		storageSet(archiveKey, archiveImages);
		initialCoverSelector = coverSelector;
		initialCoverAttr = coverAttr;
		initialArchiveImages = archiveImages;
		Object.assign(initial, {
			title,
			site_url: siteUrl,
			feed_url: effectiveFeedUrl || initial.feed_url,
			category_id: categoryId,
			crawler,
			scraper_rules: scraperRules,
			rewrite_rules: rewriteRules,
			disabled,
			ignore_http_cache: ignoreHttpCache,
			user_agent: userAgent
		});
		initialRssSignature = rssSignature;
		initialPageFeedKey = pageFeedConfigKey(pageFeedConfig);
		pageFeedBaseline = $state.snapshot(pageFeedConfig);
		pageFeedSigned = null;
	}

	// Put every field back to the saved baseline. Leaving the screen stays on ← / X.
	function discardChanges() {
		title = initial.title;
		siteUrl = initial.site_url;
		categoryId = initial.category_id;
		newCategoryName = '';
		crawler = initial.crawler;
		scraperRules = initial.scraper_rules;
		rewriteRules = initial.rewrite_rules;
		disabled = initial.disabled;
		ignoreHttpCache = initial.ignore_http_cache;
		userAgent = initial.user_agent;
		const rss = JSON.parse(initialRssSignature);
		rssEnabled = rss.rssEnabled;
		rssInstance = rss.rssInstance;
		rssBridge = rss.rssBridge;
		rssSourceUrl = rss.rssSourceUrl;
		rssParams = rss.rssParams;
		coverSelector = initialCoverSelector;
		coverAttr = initialCoverAttr;
		archiveImages = initialArchiveImages;
		pageFeedConfig = structuredClone(pageFeedBaseline);
		pageFeedSigned = null;
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
			if (!dirty) return;
			await persistChanges(changes);
			const at = (savedAt = Date.now());
			// "Saved" is a short-lived acknowledgement, not a standing state.
			setTimeout(() => {
				if (savedAt === at) savedAt = 0;
			}, 2000);
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

	// Nav hints: what each section is about, or its live state where that is cheap to show.
	const pageFeedHost = $derived.by(() => {
		try {
			return new URL(pageFeedConfig.pageUrl).host;
		} catch {
			return '';
		}
	});
	const hints = $derived<Record<string, string>>({
		general: 'Title, category, URLs',
		network: disabled ? 'Updates paused' : 'User agent, cache, pause',
		'page-feed': pageFeedHost ? `Page Feed · ${pageFeedHost}` : 'Page Feed',
		'rss-bridge': rssEnabled ? `On · ${rssBridge || 'no bridge'}` : 'Off',
		'original-content': crawler ? 'Crawler on' : 'Crawler, scraper & rewrite rules',
		'cover-image': coverSelector ? `Selector: ${coverSelector}` : 'Default (og:image)',
		'image-archive': archiveImages ? 'On' : 'Off',
		'danger-zone': 'Unsubscribe from this feed'
	});

	const dirtyLabel = $derived(
		navItems.filter((item) => dirtySections.has(item.id)).map((item) => item.label).join(', ')
	);

	// Why a dirty form can't be saved yet — shown in place of Save (never a disabled button).
	const blockedReason = $derived(
		categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim()
			? 'Name the new category to save'
			: (rssEnabled || isPageFeed) && !effectiveFeedUrl
				? isPageFeed
					? 'Preview the page feed to sign it before saving'
					: 'Enter an RSS-Bridge instance to save'
				: null
	);
</script>

<div class="flex w-full flex-col gap-7 py-6 pl-5 pr-6 md:flex-row max-md:gap-4 max-md:px-2 max-md:py-4">
	<!-- Section navigation: a column on desktop, horizontal tabs on mobile -->
	<nav
		class="flex shrink-0 gap-0.5 md:sticky md:top-6 md:w-58 md:flex-col md:self-start max-md:overflow-x-auto max-md:[scrollbar-width:none]"
	>
		{#each navItems as item (item.id)}
			{@const active = activeSection === item.id}
			{@const danger = item.id === 'danger-zone'}
			{#if danger}
				<div class="mx-2.5 my-2 h-px bg-n-200 max-md:hidden"></div>
			{/if}
			<button
				type="button"
				onclick={() => (activeSection = item.id)}
				aria-current={active ? 'page' : undefined}
				class="flex h-11 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors max-md:h-9 {active
					? danger
						? 'bg-danger/8 text-danger'
						: 'bg-a-600/12 text-a-700'
					: danger
						? 'text-danger hover:bg-danger/8'
						: 'text-n-700 hover:bg-n-200/60'}"
			>
				<item.icon size={16} class="shrink-0 {active || danger ? '' : 'text-n-500'}" />
				<span class="min-w-0">
					<span class="block truncate whitespace-nowrap text-[13.5px] {active ? 'font-[650]' : 'font-[450]'}">{item.label}</span>
					<span class="block truncate text-[11.5px] text-n-500 max-md:hidden">{hints[item.id]}</span>
				</span>
			</button>
		{/each}
	</nav>

	<!-- Sections: only the active one is shown -->
	<div class="flex min-w-0 max-w-180 flex-1 flex-col gap-3.5">
		<FeedGeneralSection
			active={activeSection === 'general'}
			{feed}
			{entryCount}
			bind:title
			bind:categoryId
			bind:newCategoryName
			bind:siteUrl
			bind:rssSourceUrl
			feedUrlManagedBy={isPageFeed ? 'page-feed' : rssEnabled ? 'rss-bridge' : null}
			{effectiveFeedUrl}
		/>

		<FeedNetworkSection
			active={activeSection === 'network'}
			bind:userAgent
			bind:disabled
			bind:ignoreHttpCache
		/>

		{#if isPageFeed}
			<FeedPageFeedSection
				active={activeSection === 'page-feed'}
				bind:config={pageFeedConfig}
				bind:signed={pageFeedSigned}
				initialKey={initialPageFeedKey}
				storedFeedUrl={initial.feed_url}
			/>
		{:else}
			<FeedRssBridgeSection
				active={activeSection === 'rss-bridge'}
				bind:rssEnabled
				bind:rssInstance
				bind:rssBridge
				bind:rssSourceUrl
				bind:rssParams
				{rssSourceKey}
			/>
		{/if}

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

		<FeedImageArchiveSection active={activeSection === 'image-archive'} bind:archiveImages />

		<FeedDangerZoneSection active={activeSection === 'danger-zone'} {feed} />

		<!-- Action row: directly under the card, and only while something is pending. -->
		{#if dirty || saving}
			<div class="flex flex-wrap items-center gap-2.5 px-1">
				{#if !blockedReason}
					<button
						type="button"
						onclick={handleSave}
						class="h-9 rounded-lg bg-a-600 px-4.5 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-a-700 {saving ? 'pointer-events-none' : ''}"
					>
						{saving ? 'Saving…' : 'Save'}
					</button>
				{/if}
				<button
					type="button"
					onclick={discardChanges}
					class="h-9 rounded-lg px-3.5 text-[13.5px] font-semibold text-n-700 transition-colors hover:bg-n-200 {saving ? 'pointer-events-none' : ''}"
				>
					Discard
				</button>
				<span class="ml-1 inline-flex items-center gap-1.5 text-[13px] text-n-500">
					<span class="size-1.5 shrink-0 rounded-full bg-warning"></span>
					{blockedReason ?? (dirtyLabel ? `Unsaved changes in ${dirtyLabel}` : 'Unsaved changes')}
				</span>
			</div>
		{:else if savedAt}
			<div class="px-1 text-sm text-n-500">Saved</div>
		{/if}
	</div>
</div>
