<script lang="ts">
	import type { Feed, FeedUpdate } from '$lib/types';
	import { ExternalLink, RotateCw, Trash2, AlertTriangle, X, Plus } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { apiCall } from '$lib/api';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { relaTimestamp } from '$lib/time';
	import { storageGet, storageGetString, storageSet } from '$lib/storage';
	import {
		isRssBridgeUrl,
		parseRssBridgeUrl,
		buildRssBridgeUrl,
		RSS_BRIDGE_STORAGE_PREFIX,
		type RssBridgeConfig,
		type RssBridgeParam
	} from '$lib/rssbridge';
	import {
		DEDUP_STORAGE_PREFIX,
		DEDUP_OPTIONS,
		asDedupMode,
		type DedupMode
	} from '$lib/dedup';
	import { COVER_STORAGE_PREFIX, asCoverRule } from '$lib/cover';
	import { USER_AGENT_PRESETS, CUSTOM_UA, matchUserAgentPreset } from '$lib/userAgent';
	import AiRuleAssistant from './AiRuleAssistant.svelte';

	let { feed }: { feed: Feed } = $props();

	const categories = feeds.getCategories();

	const navItems = [
		{ id: 'general', label: 'General' },
		{ id: 'network', label: 'Network Settings' },
		{ id: 'rss-bridge', label: 'RSS-Bridge' },
		{ id: 'original-content', label: 'Original Content' },
		{ id: 'cover-image', label: 'Cover Image' },
		{ id: 'update-behaviour', label: 'Update Behaviour' },
		{ id: 'danger-zone', label: 'Danger Zone' }
	];
	let activeSection = $state('general');
	let container = $state<HTMLElement | null>(null);

	function scrollToSection(id: string) {
		container?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

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
		blocklist_rules: feed.blocklist_rules ?? '',
		keeplist_rules: feed.keeplist_rules ?? '',
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
	let blocklistRules = $state(initial.blocklist_rules);
	let keeplistRules = $state(initial.keeplist_rules);
	let disabled = $state(initial.disabled);
	let ignoreHttpCache = $state(initial.ignore_http_cache);
	let userAgent = $state(initial.user_agent);

	// Which preset the current UA string maps to (drives the selector); typing a
	// value not in the list resolves to CUSTOM_UA, flipping the select to "Custom…".
	const uaPreset = $derived(matchUserAgentPreset(userAgent));
	function applyUaPreset(choice: string) {
		if (choice === CUSTOM_UA) return; // keep whatever's already in the field
		userAgent = choice; // the preset's value ('' for the Miniflux default)
	}

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
	let rssParams = $state<RssBridgeParam[]>(rss0.params);

	// The feed_url actually sent to Miniflux: the assembled bridge URL when on, else direct.
	const effectiveFeedUrl = $derived(
		rssEnabled
			? buildRssBridgeUrl({
					instance: rssInstance,
					bridge: rssBridge,
					sourceUrl: rssSourceUrl,
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

	function addRssParam() {
		rssParams = [...rssParams, { key: '', value: '' }];
	}
	function removeRssParam(i: number) {
		rssParams = rssParams.filter((_, idx) => idx !== i);
	}

	// --- Duplicate handling (client-side, per feed, localStorage) ---------------------
	// svelte-ignore state_referenced_locally
	const dedupKey = DEDUP_STORAGE_PREFIX + feed.id;
	const dedup0 = asDedupMode(storageGetString(dedupKey, 'off'));
	let dedupMode = $state<DedupMode>(dedup0);
	let initialDedupMode = $state<DedupMode>(dedup0);

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
	let confirmDelete = $state(false);
	let deleting = $state(false);

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

	// Scroll-spy. The content is taller than the scroll range, so lower sections can never
	// reach a fixed line near the top of the viewport. Instead map scroll *progress* (0…1)
	// onto the sections' positions, so each gets a proportional slice and the bottom always
	// lands on the last one — no section is skipped regardless of its height.
	onMount(() => {
		const scroller = container?.parentElement;
		if (!container || !scroller) return;
		const sections = Array.from(container.querySelectorAll<HTMLElement>('section[id]'));
		if (sections.length === 0) return;

		function update() {
			const scTop = scroller.getBoundingClientRect().top;
			const offsets = sections.map((s) => s.getBoundingClientRect().top - scTop + scroller.scrollTop);
			const lastOffset = offsets[offsets.length - 1];
			const maxScroll = scroller.scrollHeight - scroller.clientHeight;
			const progress = maxScroll > 4 ? Math.min(1, Math.max(0, scroller.scrollTop / maxScroll)) : 0;
			const pos = progress * lastOffset;
			let current = sections[0].id;
			for (let i = 0; i < offsets.length; i++) {
				if (offsets[i] <= pos + 1) current = sections[i].id;
			}
			activeSection = current;
		}

		update();
		scroller.addEventListener('scroll', update, { passive: true });
		return () => scroller.removeEventListener('scroll', update);
	});

	const dirty = $derived(
		title !== initial.title ||
		siteUrl !== initial.site_url ||
		effectiveFeedUrl !== initial.feed_url ||
		rssSignature !== initialRssSignature ||
		dedupMode !== initialDedupMode ||
		coverSelector !== initialCoverSelector ||
		coverAttr !== initialCoverAttr ||
		categoryId !== initial.category_id ||
		crawler !== initial.crawler ||
		scraperRules !== initial.scraper_rules ||
		rewriteRules !== initial.rewrite_rules ||
		blocklistRules !== initial.blocklist_rules ||
		keeplistRules !== initial.keeplist_rules ||
		disabled !== initial.disabled ||
		ignoreHttpCache !== initial.ignore_http_cache ||
		userAgent !== initial.user_agent
	);

	function computeChanges(): FeedUpdate {
		const changes: FeedUpdate = {};
		if (title !== initial.title) changes.title = title;
		if (siteUrl !== initial.site_url) changes.site_url = siteUrl;
		if (effectiveFeedUrl !== initial.feed_url) changes.feed_url = effectiveFeedUrl;
		if (categoryId !== initial.category_id) changes.category_id = categoryId;
		if (crawler !== initial.crawler) changes.crawler = crawler;
		if (scraperRules !== initial.scraper_rules) changes.scraper_rules = scraperRules;
		if (rewriteRules !== initial.rewrite_rules) changes.rewrite_rules = rewriteRules;
		if (blocklistRules !== initial.blocklist_rules) changes.blocklist_rules = blocklistRules;
		if (keeplistRules !== initial.keeplist_rules) changes.keeplist_rules = keeplistRules;
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
			params: rssParams
		};
		storageSet(rssKey, rssConfig);
		storageSet(dedupKey, dedupMode);
		initialDedupMode = dedupMode;
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
			blocklist_rules: blocklistRules,
			keeplist_rules: keeplistRules,
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
		const changes = computeChanges();
		if (
			Object.keys(changes).length === 0 &&
			rssSignature === initialRssSignature &&
			dedupMode === initialDedupMode &&
			coverSelector === initialCoverSelector &&
			coverAttr === initialCoverAttr
		)
			return;
		saving = true;
		try {
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

	async function unsubscribe() {
		deleting = true;
		try {
			await feeds.deleteFeed(feed.id);
			goto('/');
		} catch {
			deleting = false;
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

<div bind:this={container} class="flex w-full max-w-5xl gap-6 py-6 sm:px-6">
	<!-- Section navigation -->
	<nav class="hidden w-44 shrink-0 md:block">
		<div class="sticky top-4">
			<h2 class="mb-4 px-3 text-lg font-semibold text-n-800">Edit Feed</h2>
			<ul class="space-y-1">
			{#each navItems as item (item.id)}
				<li>
					<button
						type="button"
						onclick={() => scrollToSection(item.id)}
						class={`w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
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

	<!-- Sections -->
	<div class="min-w-0 flex-1 max-w-170 space-y-6 max-md:px-2">
		<!-- General -->
		<section id="general" class="scroll-mt-4 rounded-lg border border-n-100 bg-surface p-5 shadow-xl">
			<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">General</h3>

			<!-- Stats -->
			<div class="flex gap-5 mb-4">
			  <div><span class="font-semibold text-n-500 uppercase text-xs">Last refresh:</span> <span class="" title={feed.checked_at ?? ''}>{feed.checked_at ? `${relaTimestamp(feed.checked_at)} ago` : '—'}</span></div>
			  <div><span class="font-semibold text-n-500 uppercase text-xs">Total entries:</span> <span class="text-n-800">{entryCount ?? '—'}</span></div>
			</div>
			{#if feed.parsing_error_count && feed.parsing_error_count > 0}
				<div class="text-red-600 mb-4 bg-red-50 border border-red-600 rounded px-4 py-2">
					<p class="flex items-center gap-1.5 ">
						<AlertTriangle class="h-4 w-4 shrink-0" />
						<span class="">Parsing errors</span>
  				  <span class="">{feed.parsing_error_count}×</span>
					</p>
						{#if feed.parsing_error_message}
							<p class="text-sm mt-1">{feed.parsing_error_message}</p>
						{/if}
				</div>
			{/if}

			<div class="space-y-4 pb-2">
	      <div class="flex gap-4 flex-wrap">
					<div class="w-full lg:w-2/3">
						<label for="feed-title" class="mb-1 block text-sm font-medium text-n-700">Title</label>
						<input
							id="feed-title"
							type="text"
							bind:value={title}
							class="w-full rounded-md border border-n-300 px-3 py-2 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-n-400"
						/>
					</div>
					<div class="grow">
						<label for="feed-category" class="mb-1 block text-sm font-medium text-n-700">Category</label>
						<select
							id="feed-category"
							bind:value={categoryId}
							class="w-full text-base rounded-md border border-n-300 bg-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-n-400"
						>
							{#each categories as cat (cat.id)}
  						<option value={cat.id}>{cat.title}</option>
  					{/each}
  				</select>
  			</div>
				</div>

				<div>
					<label for="feed-feed-url" class="mb-1 block text-sm font-medium text-n-700">Feed URL</label>
					{#if rssEnabled}
						<input
							id="feed-feed-url"
							type="url"
							value={effectiveFeedUrl}
							readonly
							class="w-full rounded-md border border-n-200 bg-n-50 px-3 py-2 text-sm text-n-500 focus:outline-none"
						/>
						<p class="mt-1 text-xs text-n-500">
							Managed by RSS-Bridge — edit the parameters below, or disable it to set a direct URL.
						</p>
					{:else}
						<input
							id="feed-feed-url"
							type="url"
							bind:value={rssSourceUrl}
							class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						/>
					{/if}
				</div>
				<div>
 					<label for="feed-site-url" class="mb-1 block text-sm font-medium text-n-700">Site URL</label>
 					<input
						id="feed-site-url"
						type="url"
						bind:value={siteUrl}
						class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
 					/>
				</div>



			</div>


		</section>

		<!-- Network -->
		<section id="network" class="scroll-mt-4 rounded-lg border border-n-100 shadow-xl bg-surface p-5">
			<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Network Settings</h3>
			<div>
				<label for="feed-user-agent" class="mb-1 block text-sm font-medium text-n-700">User Agent</label>
				<div class="flex flex-col gap-2">
					<select
						aria-label="User Agent preset"
						value={uaPreset}
						onchange={(e) => applyUaPreset(e.currentTarget.value)}
						class="w-full shrink-0 rounded-md border border-n-300 bg-surface px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 max-w-fit"
					>
						{#each USER_AGENT_PRESETS as p (p.label)}
							<option value={p.value}>{p.label}</option>
						{/each}
						<option value={CUSTOM_UA}>Custom…</option>
					</select>
					<textarea
						id="feed-user-agent"
						bind:value={userAgent}
						rows="2"
						spellcheck="false"
						placeholder="Leave empty to use the Miniflux default"
						class="min-w-0 w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-xs break-all focus:outline-none focus:ring-2 focus:ring-n-400"
					></textarea>
				</div>
				<p class="mt-1 text-xs text-n-500">
					Overrides the User-Agent Miniflux sends when fetching this feed (its
					<em>Override Default User Agent</em> setting). Empty uses the server default. Some sites
					(e.g. <code>reddit.com</code>) rate-limit that default with HTTP 429 — pick a preset or
					enter your own, then save and refresh the feed.
				</p>
			</div>
		</section>

		<!-- RSS-Bridge -->
		<section id="rss-bridge" class="scroll-mt-4 rounded-lg border border-n-100 bg-surface p-5 shadow-xl">
			<div class="mb-4 flex items-center justify-between">
				<h3 class="text-sm font-semibold uppercase tracking-wide text-n-500">RSS-Bridge</h3>
				<label class="flex items-center gap-2 text-sm text-n-700">
					<input type="checkbox" bind:checked={rssEnabled} class="rounded border-n-300" />
					Enabled
				</label>
			</div>

			<p class="mb-4 text-xs text-n-500">
				Route this feed through an RSS-Bridge instance. When disabled, the parameters are kept but
				the feed uses the direct Source URL (shown in General). Save, then refresh the feed to
				re-pull entries from the new URL.
			</p>

			<div class={`space-y-4 transition-opacity ${rssEnabled ? '' : 'pointer-events-none opacity-50'}`}>
				<div class="flex flex-wrap gap-4">
					<div class="grow">
						<label for="rss-instance" class="mb-1 block text-sm font-medium text-n-700">Instance</label>
						<input
							id="rss-instance"
							type="url"
							bind:value={rssInstance}
							disabled={!rssEnabled}
							placeholder="https://rssbridge.de/"
							class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
						/>
					</div>
					<div class="grow">
						<label for="rss-bridge-name" class="mb-1 block text-sm font-medium text-n-700">Bridge</label>
						<input
							id="rss-bridge-name"
							type="text"
							bind:value={rssBridge}
							disabled={!rssEnabled}
							placeholder="FilterBridge"
							class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
						/>
					</div>
				</div>

				<div>
					<label for="rss-source" class="mb-1 block text-sm font-medium text-n-700">Source URL</label>
					<input
						id="rss-source"
						type="url"
						bind:value={rssSourceUrl}
						disabled={!rssEnabled}
						placeholder="https://example.com/feed.atom"
						class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
					/>
					<p class="mt-1 text-xs text-n-500">The underlying feed the bridge wraps (the <code>url</code> parameter).</p>
				</div>

				<div>
					<div class="mb-1 flex items-center justify-between">
						<span class="text-sm font-medium text-n-700">Parameters</span>
						<button
							type="button"
							onclick={addRssParam}
							disabled={!rssEnabled}
							class="inline-flex items-center gap-1 rounded-md border border-n-300 px-2 py-1 text-xs text-n-700 hover:bg-n-100 disabled:opacity-50"
						>
							<Plus class="h-3.5 w-3.5" /> Add parameter
						</button>
					</div>
					<div class="space-y-2">
						{#each rssParams as param, i (i)}
							<div class="flex items-center gap-2">
								<input
									type="text"
									bind:value={param.key}
									disabled={!rssEnabled}
									placeholder="filter_type"
									class="w-40 rounded-md border border-n-300 px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
								/>
								<input
									type="text"
									bind:value={param.value}
									disabled={!rssEnabled}
									placeholder="block"
									class="min-w-0 flex-1 rounded-md border border-n-300 px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
								/>
								<button
									type="button"
									onclick={() => removeRssParam(i)}
									disabled={!rssEnabled}
									title="Remove parameter"
									class="shrink-0 rounded-md p-1.5 text-n-400 hover:bg-n-100 hover:text-n-700 disabled:opacity-50"
								>
									<X class="h-4 w-4" />
								</button>
							</div>
						{/each}
						{#if rssParams.length === 0}
							<p class="text-xs text-n-400">No parameters.</p>
						{/if}
					</div>
				</div>
			</div>
		</section>

		<!-- Original content -->
		<section id="original-content" class="scroll-mt-4 rounded-lg border border-n-100 shadow-xl bg-surface p-5">
			<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Original Content</h3>
			<div class="flex flex-col xl:flex-row gap-4 items-start">
				<div class="flex items-center gap-2 xl:w-1/2">
					<input id="feed-crawler" type="checkbox" bind:checked={crawler} class="rounded border-n-300" />
					<label for="feed-crawler" class="text-sm text-n-700">Fetch original content (crawler)</label>
				</div>
				<div class="grow mb-4 xl:mb-2 xl:min-w-96">
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							onclick={refetchLatest}
							disabled={refetching || !crawler}
							class="inline-flex items-center gap-1.5 rounded-md border border-n-300 px-3 py-1.5 text-sm hover:bg-n-700 bg-n-600 disabled:opacity-50 text-white"
						>
							<RotateCw class={`h-3.5 w-3.5 ${refetching ? 'animate-spin' : ''}`} />
							{refetching ? `Re-fetching ${progress.done}/${progress.total}…` : 'Re-fetch latest'}
						</button>
						<input
							type="number"
							bind:value={refetchCount}
							min="1"
							max="100"
							disabled={refetching || !crawler}
							class="w-14 rounded-md border border-n-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
						/>
						<div>
  						<select
  							bind:value={refetchStatus}
  							disabled={refetching || !crawler}
  							class="rounded-md border border-n-300 bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
  						>
  							<option value="unread">unread</option>
  							<option value="all">all</option>
  						</select>
  						<span class="text-sm text-n-600">entries</span>
						</div>
					</div>
					<p class="mt-1 text-xs text-n-500">Saves changes, then re-applies the rules to the latest entries already downloaded.</p>
				</div>

			</div>
			<div class="space-y-3">


				<div class={`transition-opacity ${crawler ? '' : 'pointer-events-none opacity-50'}`}>
					<div>
						<label for="feed-scraper" class="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-700">
							Scraper Rules
							<a
								href="https://miniflux.app/docs/rules.html#scraper-rules"
								target="_blank"
								rel="noopener noreferrer"
								title="Miniflux documentation"
								class="text-a-600 hover:text-a-700"
							>
								<ExternalLink class="h-3.5 w-3.5" />
							</a>
						</label>
						<textarea
							id="feed-scraper"
							bind:value={scraperRules}
							rows="2"
							spellcheck="false"
							disabled={!crawler}
							placeholder='article, div[itemprop="articleBody"]'
							class="w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						></textarea>
						<p class="mt-1 text-xs text-n-500">CSS selector for the main content. Comma-separated for multiple. Only used when the crawler is on.</p>
					</div>
				</div>

				<div>
					<label for="feed-rewrite" class="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-700">
						Content Rewrite Rules
						<a
							href="https://miniflux.app/docs/rules.html#rewrite-rules"
							target="_blank"
							rel="noopener noreferrer"
							title="Miniflux documentation"
							class="text-a-600 hover:text-a-700"
						>
							<ExternalLink class="h-3.5 w-3.5" />
						</a>
					</label>
					<textarea
						id="feed-rewrite"
						bind:value={rewriteRules}
						rows="2"
						spellcheck="false"
						placeholder='remove(".ads, #promo")'
						class="w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					></textarea>
					<p class="mt-1 text-xs text-n-500">Cleanup functions, e.g. remove("…"), replace("a"|"b"). Applied to both fetched and default feed content.</p>
				</div>

				<AiRuleAssistant
					{feed}
					{crawler}
					currentScraper={scraperRules}
					currentRewrite={rewriteRules}
					onapply={applyAiRules}
				/>
			</div>
		</section>

		<!-- Cover image -->
		<section id="cover-image" class="scroll-mt-4 rounded-lg border border-n-100 shadow-xl bg-surface p-5">
			<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Cover Image</h3>
			<p class="mb-4 text-xs text-n-500">
				Where to find the card/article cover when the source has no <code>og:image</code>. Leave empty
				to use the default (the page's Open Graph image). Set a CSS selector to pull it from specific
				markup — e.g. rutracker keeps the cover in <code>&lt;var class="postImg" title="…"&gt;</code>,
				so use selector <code>var.postImg</code> with attribute <code>title</code>.
			</p>
			<div class="flex flex-wrap gap-4">
				<div class="grow">
					<label for="feed-cover-selector" class="mb-1 block text-sm font-medium text-n-700">CSS selector</label>
					<input
						id="feed-cover-selector"
						type="text"
						bind:value={coverSelector}
						spellcheck="false"
						placeholder="var.postImg"
						class="w-full rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					/>
				</div>
				<div class="w-full sm:w-48">
					<label for="feed-cover-attr" class="mb-1 block text-sm font-medium text-n-700">Attribute</label>
					<input
						id="feed-cover-attr"
						type="text"
						bind:value={coverAttr}
						spellcheck="false"
						placeholder="title (auto if empty)"
						class="w-full rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					/>
				</div>
			</div>
			<p class="mt-1 text-xs text-n-500">
				Attribute holding the URL. If empty, the app auto-detects (src, data-src, href, content, title).
				Applies when the feed is next loaded.
			</p>
		</section>

		<!-- Update behaviour -->
		<section id="update-behaviour" class="scroll-mt-4 rounded-lg border border-n-100 shadow-xl bg-surface p-5">
			<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Update Behaviour</h3>
			<div class="space-y-3">
				<div>
					<label for="feed-dedup" class="mb-1 block text-sm font-medium text-n-700">Duplicate entries</label>
					<select
						id="feed-dedup"
						bind:value={dedupMode}
						class="rounded-md border border-n-300 bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					>
						{#each DEDUP_OPTIONS as opt (opt.value)}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
					<p class="mt-1 text-xs text-n-500">
						Hide repeated entries in this feed (the source sometimes posts the same release twice).
						"By URL" is exact; "By URL + title" also collapses reposts with identical titles. Applies
						when the feed is next loaded.
					</p>
				</div>

				<div class="flex items-center gap-2">
					<input id="feed-disabled" type="checkbox" bind:checked={disabled} class="rounded border-n-300" />
					<label for="feed-disabled" class="text-sm text-n-700">Pause updates (don't refresh this feed)</label>
				</div>
				<div class="flex items-center gap-2">
					<input id="feed-ignore-cache" type="checkbox" bind:checked={ignoreHttpCache} class="rounded border-n-300" />
					<label for="feed-ignore-cache" class="text-sm text-n-700">Ignore HTTP cache (always re-download)</label>
				</div>

				<div>
					<label for="feed-blocklist" class="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-700">
						Block Rules
						<a
							href="https://miniflux.app/docs/rules.html#blocklist-rules"
							target="_blank"
							rel="noopener noreferrer"
							title="Miniflux documentation"
							class="text-a-600 hover:text-a-700"
						>
							<ExternalLink class="h-3.5 w-3.5" />
						</a>
					</label>
					<textarea
						id="feed-blocklist"
						bind:value={blocklistRules}
						rows="2"
						spellcheck="false"
						placeholder="(?i)sponsored|advertisement"
						class="w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					></textarea>
					<p class="mt-1 text-xs text-n-500">Regex on entry title/URL/author. Matching entries are discarded.</p>
				</div>

				<div>
					<label for="feed-keeplist" class="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-700">
						Keep Rules
						<a
							href="https://miniflux.app/docs/rules.html#keeplist-rules"
							target="_blank"
							rel="noopener noreferrer"
							title="Miniflux documentation"
							class="text-a-600 hover:text-a-700"
						>
							<ExternalLink class="h-3.5 w-3.5" />
						</a>
					</label>
					<textarea
						id="feed-keeplist"
						bind:value={keeplistRules}
						rows="2"
						spellcheck="false"
						placeholder="(?i)svelte|typescript"
						class="w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					></textarea>
					<p class="mt-1 text-xs text-n-500">Regex on entry title/URL/author. Only matching entries are kept.</p>
				</div>
			</div>
		</section>

		<!-- Danger zone -->
		<section id="danger-zone" class="scroll-mt-4 rounded-lg border border-n-100 shadow-xl bg-surface p-5">
			<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-red-600">Danger Zone</h3>
			{#if confirmDelete}
				<div class="flex flex-wrap items-center gap-3">
					<span class="text-sm text-n-700">Unsubscribe from <strong>{feed.title}</strong>? This removes the feed and all its entries.</span>
					<button
						type="button"
						onclick={unsubscribe}
						disabled={deleting}
						class="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
					>
						<Trash2 class="h-3.5 w-3.5" />
						{deleting ? 'Unsubscribing…' : 'Yes, unsubscribe'}
					</button>
					<button
						type="button"
						onclick={() => (confirmDelete = false)}
						disabled={deleting}
						class="rounded-md px-3 py-1.5 text-sm text-n-600 hover:bg-n-100"
					>
						Cancel
					</button>
				</div>
			{:else}
				<button
					type="button"
					onclick={() => (confirmDelete = true)}
					class="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
				>
					<Trash2 class="h-3.5 w-3.5" />
					Unsubscribe
				</button>
			{/if}
		</section>
	</div>
</div>

<!-- Sticky save bar -->
<div class="sticky bottom-0 border-t border-n-200 bg-surface/95 backdrop-blur">
	<div class="max-md:mx-auto md:ml-50 flex max-w-fit items-center gap-3 px-4 py-3 sm:px-6">
		{#if savedAt && !dirty}
			<span class="text-sm text-n-500">Saved</span>
		{/if}
		<button
			type="button"
			onclick={handleSave}
			disabled={saving || !dirty}
			class="rounded-md bg-a-600 px-4 py-2 text-sm text-white hover:bg-a-700 disabled:opacity-50"
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
