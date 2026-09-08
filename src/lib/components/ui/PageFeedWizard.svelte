<script lang="ts">
	import { Sparkles, Copy, Check } from 'lucide-svelte';
	import type { FeedCreate } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { NEW_CATEGORY_SENTINEL } from '$lib/category';
	import CategorySelect from './CategorySelect.svelte';
	import PageFeedFields from './PageFeedFields.svelte';
	import PageFeedPreviewList from './PageFeedPreviewList.svelte';
	import { aiConfig } from '$lib/stores/aiConfig.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import {
		pageFeedConfigKey,
		type PageFeedConfig,
		type PageFeedItem,
		type PageFeedMode,
		type PageFeedSuggestion
	} from '$lib/pageFeed';
	import { previewPageFeed } from '$lib/pageFeedClient';
	import { requestAi } from '$lib/ai/client';
	import {
		PAGE_FEED_SELECTOR_SYSTEM_PROMPT,
		buildSelectorUserMessage,
		parseSelectorSuggestion
	} from '$lib/ai/selectorPrompt';

	// "Feed from a page": Miniflux Reader fetches the listing page itself, extracts the items with a CSS
	// selector and serves RSS from a signed URL on its own origin; Miniflux subscribes to that URL.
	// Everything the user sees here comes from the same server extractor that will feed Miniflux.

	let { onclose, onsave, initialCategoryId, initialPageUrl }: {
		onclose: () => void;
		onsave: (data: FeedCreate) => Promise<void>;
		initialCategoryId?: number;
		// Seeded when the user lands here from Add Feed, so they don't retype the URL.
		initialPageUrl?: string;
	} = $props();

	const DEBOUNCE_MS = 400;

	// Seeding once is the intent: the wizard mounts fresh each time it opens, and from
	// there pageUrl is the user's to edit.
	// svelte-ignore state_referenced_locally
	let pageUrl = $state(initialPageUrl ?? '');
	let loadedUrl = $state(''); // the page the suggestions and preview belong to
	let pageTitle = $state('');
	let htmlSample = $state.raw('');
	let suggestions = $state.raw<PageFeedSuggestion[]>([]);
	let config = $state<PageFeedConfig>({ pageUrl: '', itemSelector: '' });
	// Kept beside the config because it survives a reseed: switching mode reloads the suggestions
	// and rebuilds the config around this.
	let mode = $state<PageFeedMode>('cards');
	let loadingPage = $state(false);
	let pageError = $state('');

	interface Preview {
		key: string; // pageFeedConfigKey of the config it ran against
		items: PageFeedItem[];
		matched: number;
		feedUrl: string;
	}
	let preview = $state.raw<Preview | null>(null);
	let attemptedKey = $state(''); // last config key a preview was started for (success or not)
	let previewing = $state(false);
	let previewError = $state('');

	let hint = $state('');
	let aiLoading = $state(false);
	let aiExplanation = $state('');

	// Preselect the category the user acted on (right-clicked in the sidebar), else
	// default to "— Without category —" (Miniflux "All"); the user's pick then sticks.
	let categoryId: number = $state(0);
	let newCategoryName = $state('');
	$effect(() => {
		if (!categoryId)
			categoryId = initialCategoryId ?? feeds.getNoCategoryId() ?? feeds.getCategories()[0]?.id ?? 0;
	});
	// Let Miniflux fetch the full articles by default — except for sections, where the feed already
	// carries the section's own markup and crawling its #fragment would fetch the whole page over it.
	let crawler = $state(true);

	let saving = $state(false);
	let copied = $state(false);

	const configKey = $derived(pageFeedConfigKey(config));
	// A preview only counts for the config it ran against.
	const current = $derived(preview && preview.key === configKey ? preview : null);
	const feedUrl = $derived(current?.feedUrl ?? '');
	// Signed for this origin — in dev that's localhost, which Miniflux can't reach.
	const unreachable = $derived(feedUrl !== '' && !feedUrl.startsWith('https://'));
	const needsCategoryName = $derived(categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim());
	const canCreate = $derived(
		!!feedUrl && !saving && !previewing && (current?.items.length ?? 0) > 0 && !needsCategoryName
	);

	let seq = 0;
	let controller: AbortController | null = null;

	// Re-preview whenever the config changes, debounced so typing a selector doesn't fire a
	// request per keystroke. attemptedKey keeps a failed preview from retrying in a loop.
	$effect(() => {
		const key = configKey;
		if (!loadedUrl || !config.itemSelector.trim() || attemptedKey === key) return;
		const timer = setTimeout(() => void runPreview(), DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function loadPage() {
		const target = pageUrl.trim();
		if (!target || loadingPage) return;
		loadingPage = true;
		pageError = '';
		try {
			const res = await previewPageFeed({ pageUrl: target, mode });
			loadedUrl = target;
			pageTitle = res.pageTitle;
			htmlSample = res.htmlSample;
			applySuggestions(target, res.suggestions);
		} catch (e) {
			pageError = e instanceof Error ? e.message : 'Failed to load page';
			loadedUrl = '';
			suggestions = [];
			preview = null;
		} finally {
			loadingPage = false;
		}
	}

	// Suggestions are scored for one mode, so both the first load and a mode switch land here.
	function applySuggestions(target: string, next: PageFeedSuggestion[]) {
		suggestions = next;
		aiExplanation = '';
		preview = null;
		attemptedKey = '';
		// Best built-in guess goes straight into the field; the effect above previews it.
		config = {
			pageUrl: target,
			itemSelector: next[0]?.selector ?? '',
			...(mode === 'sections' ? { mode } : {})
		};
	}

	// A selector chosen for cards means nothing for sections, so the switch reloads the suggestions
	// instead of previewing the old one under the new mode and reporting zero items.
	async function changeMode(next: PageFeedMode) {
		if (next === mode || loadingPage) return;
		mode = next;
		crawler = next === 'cards';
		if (!loadedUrl) return;
		loadingPage = true;
		pageError = '';
		try {
			const res = await previewPageFeed({ pageUrl: loadedUrl, mode: next });
			applySuggestions(loadedUrl, res.suggestions);
		} catch (e) {
			pageError = e instanceof Error ? e.message : 'Failed to load page';
		} finally {
			loadingPage = false;
		}
	}

	async function runPreview() {
		const cfg = $state.snapshot(config);
		const key = pageFeedConfigKey(cfg);
		if (!cfg.itemSelector.trim()) return;
		attemptedKey = key;
		controller?.abort();
		controller = new AbortController();
		const mySeq = ++seq;
		previewing = true;
		previewError = '';
		try {
			const res = await previewPageFeed(cfg, { signal: controller.signal });
			if (mySeq !== seq) return;
			preview = { key, items: res.items ?? [], matched: res.matched ?? 0, feedUrl: res.feedUrl ?? '' };
		} catch (e) {
			if (mySeq !== seq) return;
			if (e instanceof DOMException && e.name === 'AbortError') return;
			previewError = e instanceof Error ? e.message : 'Preview failed';
			preview = null;
		} finally {
			if (mySeq === seq) previewing = false;
		}
	}

	async function suggest() {
		if (!loadedUrl || !htmlSample || aiLoading) return;
		aiLoading = true;
		try {
			const text = await requestAi(PAGE_FEED_SELECTOR_SYSTEM_PROMPT, [
				{
					role: 'user',
					content: buildSelectorUserMessage({ pageUrl: loadedUrl, pageHtml: htmlSample, hint })
				}
			]);
			const suggestion = parseSelectorSuggestion(text);
			aiExplanation = suggestion.explanation;
			// The server scores the model's candidates next to the built-ins with the real extractor.
			const res = await previewPageFeed(
				{ pageUrl: loadedUrl, mode },
				{ candidates: suggestion.url_selectors }
			);
			suggestions = res.suggestions;
			const best =
				res.suggestions.find((s) => suggestion.url_selectors.includes(s.selector)) ?? res.suggestions[0];
			if (best) config.itemSelector = best.selector;
			else ui.showError('None of the suggested selectors matched a listing on this page.');
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'AI request failed');
		} finally {
			aiLoading = false;
		}
	}

	async function handleCreate() {
		if (!canCreate) return;
		saving = true;
		try {
			const categoryIdToUse = categoryId === NEW_CATEGORY_SENTINEL
				? (await feeds.createCategory(newCategoryName.trim())).id
				: categoryId;
			const data: FeedCreate = { feed_url: feedUrl, category_id: categoryIdToUse };
			if (crawler) data.crawler = true;
			await onsave(data);
			onclose();
		} catch {
			// Error shown by store
		} finally {
			saving = false;
		}
	}

	async function copyUrl() {
		try {
			await navigator.clipboard.writeText(feedUrl);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable — the field is selectable anyway
		}
	}
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-40 bg-overlay/30" onclick={onclose}></div>

<div class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
	<div class="bg-surface rounded-lg shadow-xl w-full max-w-2xl mx-4 pointer-events-auto flex max-h-[90vh] flex-col">
		<div class="px-5 py-4 border-b border-n-200">
			<h2 class="text-lg font-semibold text-n-800">Feed from a page</h2>
			<p class="mt-0.5 text-xs text-n-500">
				Turns any listing page — a tag, a section, a "latest" list — into a feed generated by
				Miniflux Reader. Miniflux subscribes to it like a normal feed.
			</p>
		</div>

		<div class="px-5 py-4 space-y-4 overflow-y-auto">
			<!-- Step 1: page -->
			<div>
				<label for="pfw-page-url" class="block text-sm font-medium text-n-700 mb-1">Page URL</label>
				<div class="flex gap-2">
					<input
						id="pfw-page-url"
						type="url"
						bind:value={pageUrl}
						onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), loadPage())}
						placeholder="https://example.com/tag/topic"
						class="min-w-0 flex-1 px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					/>
					<button
						type="button"
						onclick={loadPage}
						disabled={loadingPage || !pageUrl.trim()}
						class="shrink-0 px-4 py-2 text-sm bg-n-600 text-n-50 rounded-md hover:bg-n-700 disabled:opacity-50"
					>
						{loadingPage ? 'Loading…' : loadedUrl && pageUrl.trim() === loadedUrl ? 'Reload' : 'Load page'}
					</button>
				</div>
				{#if pageError}
					<p class="mt-1 text-xs text-danger">{pageError}</p>
				{:else if loadedUrl && pageTitle}
					<p class="mt-1 truncate text-xs text-n-500">{pageTitle}</p>
				{/if}
			</div>

			{#if loadedUrl}
				<!-- Step 2: selector -->
				<div class="space-y-2">
					{#if suggestions.length}
						<div class="flex flex-wrap gap-1.5">
							{#each suggestions as s (s.selector)}
								<button
									type="button"
									onclick={() => (config.itemSelector = s.selector)}
									title={s.sample}
									class={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
										config.itemSelector === s.selector
											? 'border-a-600 bg-a-50 text-a-700'
											: 'border-n-300 text-n-600 hover:bg-n-100'
									}`}
								>
									{s.selector}
									<span class="ml-1 font-sans text-n-400">
										{s.items} item{s.items === 1 ? '' : 's'}{s.dated ? `, ${s.dated} dated` : ''}
									</span>
								</button>
							{/each}
						</div>
					{:else}
						<p class="text-xs text-warning">
							{#if mode === 'sections'}
								No repeated headings found on this page. Enter a heading selector below, or try Item
								cards.
							{:else}
								No obvious listing found on this page. Enter a selector below, or ask the AI for one.
							{/if}
						</p>
					{/if}

					<PageFeedFields bind:config idPrefix="pfw" onmodechange={changeMode} disabled={loadingPage} />

					{#if aiConfig.isConfigured}
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={hint}
								disabled={aiLoading}
								onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), suggest())}
								placeholder="Optional hint, e.g. “the article cards, not the sidebar”"
								class="min-w-0 flex-1 px-3 py-1.5 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
							/>
							<button
								type="button"
								onclick={suggest}
								disabled={aiLoading}
								class="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-a-600 px-3 py-1.5 text-sm text-on-accent hover:bg-a-700 disabled:opacity-50"
							>
								<Sparkles class={`h-3.5 w-3.5 ${aiLoading ? 'animate-pulse' : ''}`} />
								{aiLoading ? 'Working…' : aiExplanation ? 'Suggest again' : 'Suggest with AI'}
							</button>
						</div>
					{:else}
						<p class="text-xs text-n-500">
							Connect an AI provider in
							<a href="/settings" class="text-a-600 underline hover:text-a-700">Settings</a>
							to get selector suggestions, or find one via DevTools.
						</p>
					{/if}
					{#if aiExplanation}
						<p class="text-xs text-n-500">{aiExplanation}</p>
					{/if}

					{#if previewError}
						<p class="text-xs text-danger">{previewError}</p>
					{:else if current}
						<PageFeedPreviewList items={current.items} matched={current.matched} {mode} />
					{:else if previewing || (config.itemSelector.trim() && attemptedKey !== configKey)}
						<p class="text-xs text-n-500">Previewing…</p>
					{/if}
				</div>

				<!-- Step 3: options -->
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label for="pfw-category" class="block text-sm font-medium text-n-700 mb-1">Category</label>
						<CategorySelect id="pfw-category" bind:value={categoryId} bind:newName={newCategoryName} />
					</div>
					<div class="flex items-start gap-2 sm:pt-7">
						<input id="pfw-crawler" type="checkbox" bind:checked={crawler} class="mt-0.5 rounded border-n-300" />
						<label for="pfw-crawler" class="text-sm text-n-700">
							Fetch original content (crawler)
							<span class="block text-xs text-n-500">
								{#if mode === 'sections'}
									Leave off — each item already carries its whole section, and crawling would replace
									it with the entire page.
								{:else}
									Recommended — the page only gives titles and summaries. Untick if the site is slow.
								{/if}
							</span>
						</label>
					</div>
				</div>

				<!-- Step 4: resulting URL -->
				{#if feedUrl}
					<div class="space-y-2">
						<label for="pfw-feed-url" class="block text-sm font-medium text-n-700">Feed URL</label>
						<div class="flex gap-2">
							<input
								id="pfw-feed-url"
								type="url"
								value={feedUrl}
								readonly
								class="min-w-0 flex-1 rounded-md border border-n-200 bg-n-50 px-3 py-2 font-mono text-xs text-n-500 focus:outline-none"
							/>
							<button
								type="button"
								onclick={copyUrl}
								title="Copy URL"
								class="shrink-0 rounded-md border border-n-300 p-2 text-n-600 hover:bg-n-100"
							>
								{#if copied}<Check class="h-4 w-4 text-success" />{:else}<Copy class="h-4 w-4" />{/if}
							</button>
						</div>
						{#if unreachable}
							<p class="text-xs text-warning">
								This URL points at a non-HTTPS origin (a dev server?). Miniflux has to be able to
								reach it — create the feed from the deployed app.
							</p>
						{/if}
					</div>
				{/if}
			{/if}
		</div>

		<div class="flex justify-end gap-2 border-t border-n-200 px-5 py-4">
			<button
				type="button"
				onclick={onclose}
				class="px-4 py-2 text-sm text-n-600 hover:bg-n-100 rounded-md"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={handleCreate}
				disabled={!canCreate}
				class="px-4 py-2 text-sm bg-a-600 text-on-accent rounded-md hover:bg-a-700 disabled:opacity-50"
			>
				{saving ? 'Creating…' : 'Create feed'}
			</button>
		</div>
	</div>
</div>
