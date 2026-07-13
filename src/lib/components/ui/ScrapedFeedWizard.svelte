<script lang="ts">
	import { Sparkles, Copy, Check, FlaskConical } from 'lucide-svelte';
	import type { FeedCreate } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { NEW_CATEGORY_SENTINEL } from '$lib/category';
	import CategorySelect from './CategorySelect.svelte';
	import { aiConfig } from '$lib/stores/aiConfig.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { storageGetString, storageSet } from '$lib/storage';
	import {
		buildRssBridgeUrl,
		isRssBridgeUrl,
		parseRssBridgeUrl,
		RSS_BRIDGE_INSTANCE_KEY
	} from '$lib/rssbridge';
	import {
		parsePage,
		matchItems,
		anchorizeSelector,
		buildScrapedFeedConfig,
		countBridgeEntries,
		type MatchResult
	} from '$lib/scrapedFeed';
	import { requestAi } from '$lib/ai/client';
	import {
		SELECTOR_SYSTEM_PROMPT,
		buildSelectorUserMessage,
		parseSelectorSuggestion
	} from '$lib/ai/selectorPrompt';

	let { onclose, onsave }: {
		onclose: () => void;
		onsave: (data: FeedCreate) => Promise<void>;
	} = $props();

	// Instance prefill: the remembered choice, else the instance of any existing bridge feed.
	function defaultInstance(): string {
		const stored = storageGetString(RSS_BRIDGE_INSTANCE_KEY);
		if (stored) return stored;
		for (const f of feeds.rawFeeds) {
			if (isRssBridgeUrl(f.feed_url)) {
				const inst = parseRssBridgeUrl(f.feed_url)?.instance;
				if (inst) return inst;
			}
		}
		return '';
	}

	// /api/fetch-page slices the cleaned HTML to exactly this size (its MAX_BYTES).
	const PAGE_CAP = 80_000;
	const PREVIEW_LIMIT = 20;

	let pageUrl = $state('');
	let loadedUrl = $state(''); // URL the current doc came from — the bridge uses this one
	let pageHtml = $state.raw('');
	let doc = $state.raw<Document | null>(null);
	let loadingPage = $state(false);
	let pageError = $state('');

	let selector = $state('');
	let hint = $state('');
	let aiLoading = $state(false);
	let aiExplanation = $state('');
	interface Candidate {
		selector: string;
		links: number;
		invalid: boolean;
	}
	let candidates = $state<Candidate[]>([]);

	let instance = $state(defaultInstance());
	let urlPattern = $state('');
	let contentSelector = $state('');
	let titleCleanup = $state('');
	let limit = $state<number | null>(null);
	let discardThumbnail = $state(false);

	// Defaults to "— Without category —" (Miniflux "All"); the user's pick then sticks.
	let categoryId: number = $state(0);
	let newCategoryName = $state('');
	$effect(() => {
		if (!categoryId) categoryId = feeds.getNoCategoryId() ?? feeds.getCategories()[0]?.id ?? 0;
	});
	let crawler = $state(true); // let Miniflux fetch the full articles by default

	let testing = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);
	let testedUrl = $state('');
	let saving = $state(false);
	let copied = $state(false);

	const truncated = $derived(pageHtml.length === PAGE_CAP);

	const matchState = $derived.by((): { result?: MatchResult; error?: string } | null => {
		if (!doc || !selector.trim()) return null;
		try {
			return { result: matchItems(doc, selector.trim(), loadedUrl) };
		} catch {
			return { error: 'Invalid CSS selector.' };
		}
	});

	// The selector actually sent to the bridge: rewritten to hit the <a> tags when the
	// user's one matches containers and `… a` resolves to the same links.
	const effectiveSelector = $derived.by(() => {
		const sel = selector.trim();
		if (!doc || !sel) return sel;
		try {
			return anchorizeSelector(doc, sel, loadedUrl);
		} catch {
			return sel;
		}
	});

	const bridgeUrl = $derived.by(() => {
		if (!loadedUrl || !selector.trim() || !instance.trim()) return '';
		return buildRssBridgeUrl(
			buildScrapedFeedConfig({
				instance,
				pageUrl: loadedUrl,
				urlSelector: effectiveSelector,
				urlPattern,
				contentSelector,
				titleCleanup,
				limit: limit ?? undefined,
				discardThumbnail
			})
		);
	});

	// A test outcome only counts for the URL it ran against.
	const testCurrent = $derived(testedUrl === bridgeUrl ? testResult : null);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function loadPage() {
		const target = pageUrl.trim();
		if (!target || loadingPage) return;
		loadingPage = true;
		pageError = '';
		try {
			const res = await fetch(`/api/fetch-page?url=${encodeURIComponent(target)}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.error || `Failed to load page (${res.status})`);
			pageHtml = data?.html ?? '';
			doc = parsePage(pageHtml);
			loadedUrl = target;
			candidates = [];
			aiExplanation = '';
		} catch (e) {
			pageError = e instanceof Error ? e.message : 'Failed to load page';
			pageHtml = '';
			doc = null;
			loadedUrl = '';
		} finally {
			loadingPage = false;
		}
	}

	function evaluate(sel: string): Candidate {
		try {
			const r = matchItems(doc!, sel, loadedUrl);
			return { selector: sel, links: r.items.length, invalid: false };
		} catch {
			return { selector: sel, links: 0, invalid: true };
		}
	}

	async function suggest() {
		if (!doc || !pageHtml || aiLoading) return;
		aiLoading = true;
		try {
			const text = await requestAi(SELECTOR_SYSTEM_PROMPT, [
				{ role: 'user', content: buildSelectorUserMessage({ pageUrl: loadedUrl, pageHtml, hint }) }
			]);
			const suggestion = parseSelectorSuggestion(text);
			aiExplanation = suggestion.explanation;
			candidates = suggestion.url_selectors.map(evaluate);
			const best =
				candidates.find((c) => !c.invalid && c.links >= 3 && c.links <= 100) ??
				candidates.find((c) => !c.invalid && c.links > 0);
			if (best) selector = best.selector;
			else ui.showError('None of the suggested selectors matched any links on this page.');
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'AI request failed');
		} finally {
			aiLoading = false;
		}
	}

	async function testBridge(): Promise<boolean> {
		if (!bridgeUrl || testing) return false;
		testing = true;
		const target = bridgeUrl;
		let result: { ok: boolean; message: string };
		try {
			const res = await fetch(`/api/fetch-page?url=${encodeURIComponent(target)}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				result = {
					ok: false,
					message: `${data?.error || `Bridge request failed (${res.status})`}. Is CssSelectorBridge in your instance's enabled_bridges?`
				};
			} else {
				const { isFeed, entries } = countBridgeEntries(data?.html ?? '');
				if (!isFeed) {
					result = {
						ok: false,
						message:
							'The response is not a feed — check the instance URL and that CssSelectorBridge is enabled.'
					};
				} else if (entries === 0) {
					result = {
						ok: false,
						message: 'The bridge responded but returned no items — check the selector.'
					};
				} else {
					result = { ok: true, message: `The bridge returned ${entries} item${entries === 1 ? '' : 's'}.` };
				}
			}
		} catch {
			result = { ok: false, message: 'Could not reach the bridge.' };
		} finally {
			testing = false;
		}
		testResult = result;
		testedUrl = target;
		return result.ok;
	}

	async function handleCreate() {
		if (!bridgeUrl || saving || testing) return;
		if (categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim()) return;
		// First click runs the test; on failure the button becomes "Create anyway".
		if (!testCurrent && !(await testBridge())) return;
		saving = true;
		try {
			const categoryIdToUse = categoryId === NEW_CATEGORY_SENTINEL
				? (await feeds.createCategory(newCategoryName.trim())).id
				: categoryId;
			const data: FeedCreate = { feed_url: bridgeUrl, category_id: categoryIdToUse };
			if (crawler) data.crawler = true;
			await onsave(data);
			storageSet(RSS_BRIDGE_INSTANCE_KEY, instance.trim());
			onclose();
		} catch {
			// Error shown by store
		} finally {
			saving = false;
		}
	}

	async function copyUrl() {
		try {
			await navigator.clipboard.writeText(bridgeUrl);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable — the field is selectable anyway
		}
	}
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-40 bg-black/30" onclick={onclose}></div>

<div class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
	<div class="bg-surface rounded-lg shadow-xl w-full max-w-2xl mx-4 pointer-events-auto flex max-h-[90vh] flex-col">
		<div class="px-5 py-4 border-b border-n-200">
			<h2 class="text-lg font-semibold text-n-800">Feed from a page without RSS</h2>
			<p class="mt-0.5 text-xs text-n-500">
				Builds an RSS-Bridge (CssSelectorBridge) feed from any listing page; Miniflux subscribes to it
				like a normal feed.
			</p>
		</div>

		<div class="px-5 py-4 space-y-4 overflow-y-auto">
			<!-- Step 1: page -->
			<div>
				<label for="wiz-page-url" class="block text-sm font-medium text-n-700 mb-1">Page URL</label>
				<div class="flex gap-2">
					<input
						id="wiz-page-url"
						type="url"
						bind:value={pageUrl}
						onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), loadPage())}
						placeholder="https://example.com/news/"
						class="min-w-0 flex-1 px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					/>
					<button
						type="button"
						onclick={loadPage}
						disabled={loadingPage || !pageUrl.trim()}
						class="shrink-0 px-4 py-2 text-sm bg-n-600 text-white rounded-md hover:bg-n-700 disabled:opacity-50"
					>
						{loadingPage ? 'Loading…' : doc ? 'Reload' : 'Load page'}
					</button>
				</div>
				{#if pageError}
					<p class="mt-1 text-xs text-red-600">{pageError}</p>
				{:else if truncated}
					<p class="mt-1 text-xs text-n-500">
						The page was truncated at 80&nbsp;KB — the preview may show fewer items than the bridge will.
					</p>
				{/if}
			</div>

			{#if doc}
				<!-- Step 2: selector -->
				<div class="space-y-2">
					<label for="wiz-selector" class="block text-sm font-medium text-n-700">
						Item link selector
					</label>
					<input
						id="wiz-selector"
						type="text"
						bind:value={selector}
						spellcheck="false"
						placeholder=".newsCard__title a"
						class="w-full px-3 py-2 border border-n-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					/>

					{#if aiConfig.isConfigured}
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={hint}
								disabled={aiLoading}
								onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), suggest())}
								placeholder="Optional hint, e.g. “the article title links, not the thumbnails”"
								class="min-w-0 flex-1 px-3 py-1.5 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
							/>
							<button
								type="button"
								onclick={suggest}
								disabled={aiLoading}
								class="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-a-600 px-3 py-1.5 text-sm text-white hover:bg-a-700 disabled:opacity-50"
							>
								<Sparkles class={`h-3.5 w-3.5 ${aiLoading ? 'animate-pulse' : ''}`} />
								{aiLoading ? 'Working…' : candidates.length ? 'Suggest again' : 'Suggest with AI'}
							</button>
						</div>
					{:else}
						<p class="text-xs text-n-500">
							Connect an AI provider in
							<a href="/settings" class="text-a-600 underline hover:text-a-700">Settings</a>
							to get selector suggestions, or find one via DevTools.
						</p>
					{/if}

					{#if candidates.length}
						<div class="flex flex-wrap gap-1.5">
							{#each candidates as c (c.selector)}
								<button
									type="button"
									onclick={() => (selector = c.selector)}
									class={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
										selector === c.selector
											? 'border-a-600 bg-a-50 text-a-700'
											: 'border-n-300 text-n-600 hover:bg-n-100'
									}`}
								>
									{c.selector}
									<span class="ml-1 font-sans text-n-400">
										{c.invalid ? 'invalid' : `${c.links} link${c.links === 1 ? '' : 's'}`}
									</span>
								</button>
							{/each}
						</div>
					{/if}
					{#if aiExplanation}
						<p class="text-xs text-n-500">{aiExplanation}</p>
					{/if}

					{#if matchState?.error}
						<p class="text-xs text-red-600">{matchState.error}</p>
					{:else if matchState?.result}
						{@const m = matchState.result}
						{#if m.items.length === 0}
							<p class="text-xs text-amber-700">
								{#if m.matched === 0}
									Nothing matches this selector. If the items are rendered by JavaScript, RSS-Bridge
									won't see them either.
								{:else}
									Matched {m.matched} element{m.matched === 1 ? '' : 's'}, but found no links in them.
								{/if}
							</p>
						{:else}
							<p class="text-xs text-n-600">
								{m.items.length} link{m.items.length === 1 ? '' : 's'} found
								({m.matched} element{m.matched === 1 ? '' : 's'} matched).
							</p>
							{#if m.nonAnchor}
								{#if effectiveSelector !== selector.trim()}
									<p class="text-xs text-n-500">
										The selector matches containers, so the bridge will use
										<code class="font-mono">{effectiveSelector}</code> to hit the links directly.
									</p>
								{:else}
									<p class="text-xs text-amber-700">
										The selector matches containers, not links. The preview resolved the links inside,
										but the bridge may not — prefer a selector that targets the
										<code class="font-mono">&lt;a&gt;</code> itself.
									</p>
								{/if}
							{/if}
							<ul class="max-h-48 divide-y divide-n-100 overflow-y-auto rounded-md border border-n-200">
								{#each m.items.slice(0, PREVIEW_LIMIT) as item (item.href)}
									<li class="px-3 py-1.5">
										<div class="truncate text-sm text-n-800">{item.title || '(no title)'}</div>
										<div class="truncate text-xs text-n-400">{item.href}</div>
									</li>
								{/each}
							</ul>
							{#if m.items.length > PREVIEW_LIMIT}
								<p class="text-xs text-n-400">…and {m.items.length - PREVIEW_LIMIT} more.</p>
							{/if}
						{/if}
					{/if}
				</div>

				<!-- Step 3: options -->
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label for="wiz-instance" class="block text-sm font-medium text-n-700 mb-1">
							RSS-Bridge instance
						</label>
						<input
							id="wiz-instance"
							type="url"
							bind:value={instance}
							placeholder="https://bridge.example.com/"
							class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						/>
					</div>
					<div>
						<label for="wiz-category" class="block text-sm font-medium text-n-700 mb-1">Category</label>
						<CategorySelect id="wiz-category" bind:value={categoryId} bind:newName={newCategoryName} />
					</div>
				</div>

				<div class="flex items-center gap-2">
					<input id="wiz-crawler" type="checkbox" bind:checked={crawler} class="rounded border-n-300" />
					<label for="wiz-crawler" class="text-sm text-n-700">
						Fetch original content (crawler) — recommended, the bridge only provides titles and links
					</label>
				</div>

				<details class="rounded-md border border-n-200">
					<summary class="cursor-pointer px-3 py-2 text-sm text-n-600 select-none">
						Advanced bridge options
					</summary>
					<div class="space-y-3 border-t border-n-100 px-3 py-3">
						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<label for="wiz-url-pattern" class="block text-xs font-medium text-n-600 mb-1">
									Link pattern (<code>url_pattern</code>, regex)
								</label>
								<input
									id="wiz-url-pattern"
									type="text"
									bind:value={urlPattern}
									spellcheck="false"
									placeholder="/news/.+"
									class="w-full px-2 py-1.5 border border-n-300 rounded-md font-mono text-xs focus:outline-none focus:ring-2 focus:ring-n-400"
								/>
							</div>
							<div>
								<label for="wiz-content-selector" class="block text-xs font-medium text-n-600 mb-1">
									Content selector (<code>content_selector</code>)
								</label>
								<input
									id="wiz-content-selector"
									type="text"
									bind:value={contentSelector}
									spellcheck="false"
									placeholder="Leave empty — the crawler handles content"
									class="w-full px-2 py-1.5 border border-n-300 rounded-md font-mono text-xs focus:outline-none focus:ring-2 focus:ring-n-400"
								/>
							</div>
							<div>
								<label for="wiz-title-cleanup" class="block text-xs font-medium text-n-600 mb-1">
									Title cleanup (<code>title_cleanup</code>)
								</label>
								<input
									id="wiz-title-cleanup"
									type="text"
									bind:value={titleCleanup}
									placeholder=" — Site Name"
									class="w-full px-2 py-1.5 border border-n-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-n-400"
								/>
							</div>
							<div>
								<label for="wiz-limit" class="block text-xs font-medium text-n-600 mb-1">
									Max items (<code>limit</code>)
								</label>
								<input
									id="wiz-limit"
									type="number"
									bind:value={limit}
									min="1"
									max="100"
									placeholder="bridge default"
									class="w-full px-2 py-1.5 border border-n-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-n-400"
								/>
							</div>
						</div>
						<div class="flex items-center gap-2">
							<input
								id="wiz-discard-thumb"
								type="checkbox"
								bind:checked={discardThumbnail}
								class="rounded border-n-300"
							/>
							<label for="wiz-discard-thumb" class="text-xs text-n-600">
								Discard item thumbnails (<code>discard_thumbnail</code>)
							</label>
						</div>
					</div>
				</details>

				<!-- Step 4: resulting URL + test -->
				{#if bridgeUrl}
					<div class="space-y-2">
						<label for="wiz-bridge-url" class="block text-sm font-medium text-n-700">Feed URL</label>
						<div class="flex gap-2">
							<input
								id="wiz-bridge-url"
								type="url"
								value={bridgeUrl}
								readonly
								class="min-w-0 flex-1 rounded-md border border-n-200 bg-n-50 px-3 py-2 font-mono text-xs text-n-500 focus:outline-none"
							/>
							<button
								type="button"
								onclick={copyUrl}
								title="Copy URL"
								class="shrink-0 rounded-md border border-n-300 p-2 text-n-600 hover:bg-n-100"
							>
								{#if copied}<Check class="h-4 w-4 text-green-600" />{:else}<Copy class="h-4 w-4" />{/if}
							</button>
							<button
								type="button"
								onclick={testBridge}
								disabled={testing}
								class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-n-300 px-3 py-2 text-sm text-n-700 hover:bg-n-100 disabled:opacity-50"
							>
								<FlaskConical class={`h-3.5 w-3.5 ${testing ? 'animate-pulse' : ''}`} />
								{testing ? 'Testing…' : 'Test'}
							</button>
						</div>
						{#if testCurrent}
							<p class={`text-xs ${testCurrent.ok ? 'text-green-700' : 'text-red-600'}`}>
								{testCurrent.message}
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
				disabled={saving || testing || !bridgeUrl || (categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim())}
				class="px-4 py-2 text-sm bg-a-600 text-white rounded-md hover:bg-a-700 disabled:opacity-50"
			>
				{saving
					? 'Creating…'
					: testing
						? 'Testing…'
						: testCurrent && !testCurrent.ok
							? 'Create anyway'
							: 'Create feed'}
			</button>
		</div>
	</div>
</div>
