<script lang="ts">
	import type { Category, Feed, FeedUpdate } from '$lib/types';
	import { ExternalLink, RotateCw } from 'lucide-svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';

	let { feed, categories, onclose, onsave }: {
		feed: Feed;
		categories: Category[];
		onclose: () => void;
		onsave: (changes: FeedUpdate) => Promise<void>;
	} = $props();

	// Capture initial values for form — modal is recreated each open so props won't change
	// svelte-ignore state_referenced_locally
	const initial = {
		title: feed.title,
		site_url: feed.site_url,
		feed_url: feed.feed_url,
		category_id: feed.category.id,
		crawler: feed.crawler ?? false,
		scraper_rules: feed.scraper_rules ?? '',
		rewrite_rules: feed.rewrite_rules ?? ''
	};
	let title = $state(initial.title);
	let siteUrl = $state(initial.site_url);
	let feedUrl = $state(initial.feed_url);
	let categoryId = $state(initial.category_id);
	let crawler = $state(initial.crawler);
	let scraperRules = $state(initial.scraper_rules);
	let rewriteRules = $state(initial.rewrite_rules);
	let saving = $state(false);
	let refetching = $state(false);
	let refetchCount = $state(25);
	let progress = $state({ done: 0, total: 0 });

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	function computeChanges(): FeedUpdate {
		const changes: FeedUpdate = {};
		if (title !== initial.title) changes.title = title;
		if (siteUrl !== initial.site_url) changes.site_url = siteUrl;
		if (feedUrl !== initial.feed_url) changes.feed_url = feedUrl;
		if (categoryId !== initial.category_id) changes.category_id = categoryId;
		if (crawler !== initial.crawler) changes.crawler = crawler;
		if (scraperRules !== initial.scraper_rules) changes.scraper_rules = scraperRules;
		if (rewriteRules !== initial.rewrite_rules) changes.rewrite_rules = rewriteRules;
		return changes;
	}

	// Persist current form state without closing, then reset the baseline so a
	// later Save sees no pending changes.
	async function persistChanges(changes: FeedUpdate) {
		await onsave(changes);
		Object.assign(initial, {
			title,
			site_url: siteUrl,
			feed_url: feedUrl,
			category_id: categoryId,
			crawler,
			scraper_rules: scraperRules,
			rewrite_rules: rewriteRules
		});
	}

	async function handleSave() {
		const changes = computeChanges();
		if (Object.keys(changes).length === 0) {
			onclose();
			return;
		}

		saving = true;
		try {
			await persistChanges(changes);
			onclose();
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

			const res = await entries.refetchFeedLatest(feed.id, refetchCount, (done, total) => {
				progress = { done, total };
			});
			const failed = res.failed ? ` (${res.failed} failed)` : '';
			ui.showSuccess(`Re-fetched ${res.ok}/${res.total} entries${failed}.`);
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to re-fetch content');
		} finally {
			refetching = false;
			progress = { done: 0, total: 0 };
		}
	}
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-40 bg-black/30" onclick={onclose}></div>

<div class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
	<div class="bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 pointer-events-auto flex max-h-[90vh] flex-col">
		<div class="px-5 py-4 border-b border-n-200 shrink-0">
			<h2 class="text-lg font-semibold text-n-800">Edit Feed</h2>
		</div>

		<form id="feed-edit-form" onsubmit={(e) => { e.preventDefault(); handleSave(); }} class="px-5 py-4 space-y-4 overflow-y-auto">
			<div>
				<label for="feed-title" class="block text-sm font-medium text-n-700 mb-1">Title</label>
				<input
					id="feed-title"
					type="text"
					bind:value={title}
					class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
			</div>

			<div>
				<label for="feed-site-url" class="block text-sm font-medium text-n-700 mb-1">Site URL</label>
				<input
					id="feed-site-url"
					type="url"
					bind:value={siteUrl}
					class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
			</div>

			<div>
				<label for="feed-feed-url" class="block text-sm font-medium text-n-700 mb-1">Feed URL</label>
				<input
					id="feed-feed-url"
					type="url"
					bind:value={feedUrl}
					class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
			</div>

			<div>
				<label for="feed-category" class="block text-sm font-medium text-n-700 mb-1">Category</label>
				<select
					id="feed-category"
					bind:value={categoryId}
					class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400 bg-surface"
				>
					{#each categories as cat (cat.id)}
						<option value={cat.id}>{cat.title}</option>
					{/each}
				</select>
			</div>

			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<input
						id="feed-crawler"
						type="checkbox"
						bind:checked={crawler}
						class="rounded border-n-300"
					/>
					<label for="feed-crawler" class="text-sm text-n-700">Fetch original content (crawler)</label>
				</div>

				<div class="pl-3 ml-1 border-l-2 border-n-200 space-y-3">
					<div>
						<label for="feed-scraper" class="flex items-center gap-1.5 text-sm font-medium text-n-700 mb-1">
							Scraper Rules
							<a
								href="https://miniflux.app/docs/rules.html#scraper-rules"
								target="_blank"
								rel="noopener noreferrer"
								title="Miniflux documentation"
								class="text-a-600 hover:text-a-700"
							>
								<ExternalLink class="w-3.5 h-3.5" />
							</a>
						</label>
						<textarea
							id="feed-scraper"
							bind:value={scraperRules}
							rows="2"
							spellcheck="false"
							placeholder='article, div[itemprop="articleBody"]'
							class="w-full px-3 py-2 border border-n-300 rounded-md text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-n-400"
						></textarea>
						<p class="text-xs text-n-500 mt-1">CSS selector for the main content. Comma-separated for multiple.</p>
					</div>

					<div>
						<label for="feed-rewrite" class="flex items-center gap-1.5 text-sm font-medium text-n-700 mb-1">
							Content Rewrite Rules
							<a
								href="https://miniflux.app/docs/rules.html#rewrite-rules"
								target="_blank"
								rel="noopener noreferrer"
								title="Miniflux documentation"
								class="text-a-600 hover:text-a-700"
							>
								<ExternalLink class="w-3.5 h-3.5" />
							</a>
						</label>
						<textarea
							id="feed-rewrite"
							bind:value={rewriteRules}
							rows="2"
							spellcheck="false"
							placeholder='remove(".ads, #promo")'
							class="w-full px-3 py-2 border border-n-300 rounded-md text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-n-400"
						></textarea>
						<p class="text-xs text-n-500 mt-1">Cleanup functions, e.g. remove("…"), replace("a"|"b").</p>
					</div>

					<div class="pt-1">
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={refetchLatest}
								disabled={refetching}
								class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-n-300 rounded-md hover:bg-n-100 disabled:opacity-50"
							>
								<RotateCw class={`w-3.5 h-3.5 ${refetching ? 'animate-spin' : ''}`} />
								{refetching ? `Re-fetching ${progress.done}/${progress.total}…` : 'Re-fetch latest'}
							</button>
							<input
								type="number"
								bind:value={refetchCount}
								min="1"
								max="100"
								disabled={refetching}
								class="w-16 px-2 py-1.5 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
							/>
							<span class="text-sm text-n-600">entries</span>
						</div>
						<p class="text-xs text-n-500 mt-1">Saves changes, then re-applies the rules to entries already downloaded.</p>
					</div>
				</div>
			</div>
		</form>

		<div class="flex justify-end gap-2 px-5 py-4 border-t border-n-200 shrink-0">
			<button
				type="button"
				onclick={onclose}
				class="px-4 py-2 text-sm text-n-600 hover:bg-n-100 rounded-md"
			>
				Cancel
			</button>
			<button
				type="submit"
				form="feed-edit-form"
				disabled={saving}
				class="px-4 py-2 text-sm bg-a-600 text-white rounded-md hover:bg-a-700 disabled:opacity-50"
			>
				{saving ? 'Saving...' : 'Save'}
			</button>
		</div>
	</div>
</div>
