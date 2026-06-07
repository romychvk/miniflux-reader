<script lang="ts">
	import type { Feed, FeedUpdate } from '$lib/types';
	import { ExternalLink, RotateCw, Trash2, AlertTriangle, X } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { apiCall } from '$lib/api';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { relaTimestamp } from '$lib/time';

	let { feed }: { feed: Feed } = $props();

	const categories = feeds.getCategories();

	const navItems = [
		{ id: 'general', label: 'General' },
		{ id: 'original-content', label: 'Original Content' },
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
		ignore_http_cache: feed.ignore_http_cache ?? false
	};
	let title = $state(initial.title);
	let siteUrl = $state(initial.site_url);
	let feedUrl = $state(initial.feed_url);
	let categoryId = $state(initial.category_id);
	let crawler = $state(initial.crawler);
	let scraperRules = $state(initial.scraper_rules);
	let rewriteRules = $state(initial.rewrite_rules);
	let blocklistRules = $state(initial.blocklist_rules);
	let keeplistRules = $state(initial.keeplist_rules);
	let disabled = $state(initial.disabled);
	let ignoreHttpCache = $state(initial.ignore_http_cache);

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
		feedUrl !== initial.feed_url ||
		categoryId !== initial.category_id ||
		crawler !== initial.crawler ||
		scraperRules !== initial.scraper_rules ||
		rewriteRules !== initial.rewrite_rules ||
		blocklistRules !== initial.blocklist_rules ||
		keeplistRules !== initial.keeplist_rules ||
		disabled !== initial.disabled ||
		ignoreHttpCache !== initial.ignore_http_cache
	);

	function computeChanges(): FeedUpdate {
		const changes: FeedUpdate = {};
		if (title !== initial.title) changes.title = title;
		if (siteUrl !== initial.site_url) changes.site_url = siteUrl;
		if (feedUrl !== initial.feed_url) changes.feed_url = feedUrl;
		if (categoryId !== initial.category_id) changes.category_id = categoryId;
		if (crawler !== initial.crawler) changes.crawler = crawler;
		if (scraperRules !== initial.scraper_rules) changes.scraper_rules = scraperRules;
		if (rewriteRules !== initial.rewrite_rules) changes.rewrite_rules = rewriteRules;
		if (blocklistRules !== initial.blocklist_rules) changes.blocklist_rules = blocklistRules;
		if (keeplistRules !== initial.keeplist_rules) changes.keeplist_rules = keeplistRules;
		if (disabled !== initial.disabled) changes.disabled = disabled;
		if (ignoreHttpCache !== initial.ignore_http_cache) changes.ignore_http_cache = ignoreHttpCache;
		return changes;
	}

	// Persist current form state and reset the baseline so dirty/Re-fetch see no pending changes.
	async function persistChanges(changes: FeedUpdate) {
		await feeds.updateFeed(feed.id, changes);
		Object.assign(initial, {
			title,
			site_url: siteUrl,
			feed_url: feedUrl,
			category_id: categoryId,
			crawler,
			scraper_rules: scraperRules,
			rewrite_rules: rewriteRules,
			blocklist_rules: blocklistRules,
			keeplist_rules: keeplistRules,
			disabled,
			ignore_http_cache: ignoreHttpCache
		});
	}

	async function handleSave() {
		const changes = computeChanges();
		if (Object.keys(changes).length === 0) return;
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
			const failed = res.failed ? ` (${res.failed} failed)` : '';
			ui.showSuccess(`Re-fetched ${res.ok}/${res.total} ${scope}entries${failed}.`);
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
	class="fixed right-4 md:right-6 top-14 z-30 rounded-full p-1.5 text-n-700 bg-surface hover:text-n-900"
>
	<X class="size-7.5" />
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
				<div class="flex items-start justify-between gap-4">
					<dt class="flex items-center gap-1.5 text-red-600">
						<AlertTriangle class="h-4 w-4 shrink-0" />
						Parsing errors
					</dt>
					<dd class="text-right text-red-600">
						{feed.parsing_error_count}×
						{#if feed.parsing_error_message}
							<span class="block text-xs text-red-500">{feed.parsing_error_message}</span>
						{/if}
					</dd>
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
					<input
						id="feed-feed-url"
						type="url"
						bind:value={feedUrl}
						class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					/>
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

		<!-- Original content -->
		<section id="original-content" class="scroll-mt-4 rounded-lg border border-n-100 shadow-xl bg-surface p-5">
			<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Original Content</h3>
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<input id="feed-crawler" type="checkbox" bind:checked={crawler} class="rounded border-n-300" />
					<label for="feed-crawler" class="text-sm text-n-700">Fetch original content (crawler)</label>
				</div>

				<div class={`space-y-3 transition-opacity ${crawler ? '' : 'pointer-events-none opacity-50'}`}>
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
						<p class="mt-1 text-xs text-n-500">CSS selector for the main content. Comma-separated for multiple.</p>
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
							disabled={!crawler}
							placeholder='remove(".ads, #promo")'
							class="w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						></textarea>
						<p class="mt-1 text-xs text-n-500">Cleanup functions, e.g. remove("…"), replace("a"|"b").</p>
					</div>

					<div class="pt-1">
						<div class="flex flex-wrap items-center gap-2">
							<button
								type="button"
								onclick={refetchLatest}
								disabled={refetching || !crawler}
								class="inline-flex items-center gap-1.5 rounded-md border border-n-300 px-3 py-1.5 text-sm hover:bg-n-100 disabled:opacity-50"
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
								class="w-16 rounded-md border border-n-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
							/>
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
						<p class="mt-1 text-xs text-n-500">Saves changes, then re-applies the rules to the latest entries already downloaded.</p>
					</div>
				</div>
			</div>
		</section>

		<!-- Update behaviour -->
		<section id="update-behaviour" class="scroll-mt-4 rounded-lg border border-n-100 shadow-xl bg-surface p-5">
			<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Update Behaviour</h3>
			<div class="space-y-3">
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
