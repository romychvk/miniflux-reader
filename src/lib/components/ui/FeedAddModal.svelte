<script lang="ts">
	import { onMount } from 'svelte';
	import { ExternalLink, FolderPlus, Plus } from 'lucide-svelte';
	import type { Category, FeedCreate } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { NEW_CATEGORY_SENTINEL } from '$lib/category';
	import CategorySelect from './CategorySelect.svelte';
	import { findFeeds, type FoundFeed } from '$lib/feedFinder';
	import { findBridges, warmBridgeCatalog, type BridgeChoice } from '$lib/bridgeFinder';
	import { defaultInstance } from '$lib/rssbridge';
	import { caps } from '$lib/backend';
	import type { BridgeMatch } from '$lib/rssbridgeCatalog';

	let { onclose, onsave, onpagefeed, onwizard, onbridge, oncategory, initialCategoryId, initialMode = 'feed' }: {
		onclose: () => void;
		onsave: (data: FeedCreate) => Promise<void>;
		// The same modal makes a bare category: the switch at the top right flips it between the two
		// forms, and the sidebar's "Add Category" opens it on that one. Told the category once it exists.
		oncategory?: (category: Category) => void;
		initialMode?: 'feed' | 'category';
		// "Build a feed from the page": Miniflux Reader's own page-feed wizard, always offered — discovery
		// can succeed with the wrong feed (a site-wide feed advertised on a tag page). The category
		// picked here travels along (undefined when it's the still-unnamed "new category" row).
		onpagefeed?: (url: string, categoryId: number | undefined) => void;
		// The RSS-Bridge CssSelectorBridge wizard, offered only when an instance is known.
		onwizard?: (url: string) => void;
		onbridge?: (choice: BridgeChoice) => void;
		initialCategoryId?: number;
	} = $props();

	// svelte-ignore state_referenced_locally
	let mode = $state(initialMode);
	let feedUrl = $state('');
	let categoryId: number = $state(0);
	let newCategoryName = $state('');
	// The Add Category form's own field — not newCategoryName, which belongs to the picker's
	// "＋ New category…" row and is created only together with a feed.
	let categoryTitle = $state('');

	// Preselect the category the user acted on (e.g. right-clicked in the sidebar);
	// otherwise fall back to the "— Without category —" (Miniflux "All") bucket, so
	// leaving the picker untouched keeps a feed uncategorized.
	$effect(() => {
		if (!categoryId)
			categoryId = initialCategoryId ?? feeds.getNoCategoryId() ?? feeds.getCategories()[0]?.id ?? 0;
	});
	let saving = $state(false);
	let discovering = $state(false);
	let found = $state.raw<FoundFeed[]>([]);
	let bridgeMatches = $state.raw<BridgeMatch[]>([]);
	let discoveredFor = $state<string | null>(null);

	// '' when no RSS-Bridge instance is known yet, or when the backend has no use for one — the
	// whole bridge offer (catalog matches, the CssSelectorBridge wizard) then stays out of the way.
	// Snapshot at mount like ScrapedFeedWizard does: the modal is created fresh each time it opens.
	const instance = caps().rssBridge ? defaultInstance() : '';

	// The instance's bridge list is ~1.2MB to read the first time, so start it while the user is
	// still typing rather than paying for it on submit.
	onMount(() => warmBridgeCatalog(instance));

	const needsCategoryName = $derived(categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim());

	// Said before Add rather than after: the server refuses a second category of the same name.
	const categoryExists = $derived.by(() => {
		const title = categoryTitle.trim();
		return title !== '' && feeds.getCategories().some((c) => c.title === title);
	});

	// Results belong to the URL they were found for, so editing the field drops them. Both sets are
	// written together, so one key covers them.
	const results = $derived(discoveredFor !== null && discoveredFor === feedUrl.trim() ? found : null);
	const bridges = $derived(
		discoveredFor !== null && discoveredFor === feedUrl.trim() ? bridgeMatches : []
	);
	const noneFound = $derived(results !== null && results.length === 0);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function addFeed(url: string) {
		saving = true;
		try {
			const categoryIdToUse = categoryId === NEW_CATEGORY_SENTINEL
				? (await feeds.createCategory(newCategoryName.trim())).id
				: categoryId;
			const data: FeedCreate = {
				feed_url: url,
				category_id: categoryIdToUse,
			};
			await onsave(data);
			onclose();
		} catch {
			// Error shown by store
		} finally {
			saving = false;
		}
	}

	async function addCategory() {
		const title = categoryTitle.trim();
		if (!title || categoryExists || saving) return;
		saving = true;
		try {
			const category = await feeds.createCategory(title);
			oncategory?.(category);
			onclose();
		} catch {
			// Error shown by store
		} finally {
			saving = false;
		}
	}

	// The typed URL may be a feed, a page that advertises feeds, or neither — ask first, then add
	// outright when there is only one answer. The instance is asked in parallel whether it already
	// has a purpose-built bridge for the domain, which is often the better feed (a hand-rolled
	// CssSelectorBridge can't read dates off a Bandcamp page; BandcampBridge can).
	async function handleSave() {
		const url = feedUrl.trim();
		if (!url || needsCategoryName || saving || discovering) return;

		discovering = true;
		let list: FoundFeed[] = [];
		let matches: BridgeMatch[] = [];
		try {
			// Safe to run together only because both helpers swallow their own errors: neither can
			// reject and take the other's answer down with it.
			[list, matches] = await Promise.all([
				findFeeds(url),
				instance ? findBridges(url, instance) : Promise.resolve<BridgeMatch[]>([])
			]);
		} finally {
			discovering = false;
		}
		found = list;
		bridgeMatches = matches;
		discoveredFor = url;

		// A matching bridge is a second answer, so it turns the one-result shortcut into a choice.
		if (list.length === 1 && matches.length === 0) await addFeed(list[0].url);
	}
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-40 bg-overlay/30" onclick={onclose}></div>

<div class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
	<div class="bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 pointer-events-auto">
		<div class="px-5 py-4 border-b border-n-200">
			<div class="flex items-center justify-between gap-3">
				<h2 class="text-lg font-semibold text-n-800">{mode === 'category' ? 'Add Category' : 'Add Feed'}</h2>
				<button
					type="button"
					onclick={() => { mode = mode === 'category' ? 'feed' : 'category'; }}
					class="h-7 pl-1.75 pr-2.5 flex shrink-0 items-center gap-1 rounded-full bg-a-50 text-a-700 text-[12.5px] font-semibold transition-colors hover:bg-a-600/12 hover:text-a-600"
				>
					{#if mode === 'category'}
						<Plus size={14} strokeWidth={2.5} />
						Add Feed
					{:else}
						<FolderPlus size={14} strokeWidth={2.5} />
						Add Category
					{/if}
				</button>
			</div>
		</div>

		{#if mode === 'category'}
			<form onsubmit={(e) => { e.preventDefault(); addCategory(); }} class="px-5 py-4 space-y-4">
				<div>
					<label for="add-category-title" class="block text-sm font-medium text-n-700 mb-1">Title</label>
					<!-- Focused on mount rather than by autofocus: after the switch is clicked, the browser
					     skips autofocus because the switch already holds the focus. -->
					<input
						{@attach (node) => node.focus()}
						id="add-category-title"
						type="text"
						bind:value={categoryTitle}
						required
						placeholder="Category name"
						class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					/>
					{#if categoryExists}
						<p class="mt-1 text-xs text-red-600">You already have a category with this name.</p>
					{/if}
				</div>

				<div class="flex justify-end gap-2 pt-2">
					<button
						type="button"
						onclick={onclose}
						class="px-4 py-2 text-sm text-n-600 hover:bg-n-100 rounded-md"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={saving || !categoryTitle.trim() || categoryExists}
						class="px-4 py-2 text-sm bg-a-600 text-on-accent rounded-md hover:bg-a-700 disabled:opacity-50"
					>
						{saving ? 'Adding...' : 'Add'}
					</button>
				</div>
			</form>
		{/if}

		<!-- Hidden rather than unmounted while the category form shows, so flipping back finds the
		     URL, the picked category and the search results as they were. -->
		<form onsubmit={(e) => { e.preventDefault(); handleSave(); }} hidden={mode !== 'feed'} class="px-5 py-4 space-y-4">
			<div>
				<label for="add-feed-url" class="block text-sm font-medium text-n-700 mb-1">Feed URL</label>
				<input
					id="add-feed-url"
					type="url"
					bind:value={feedUrl}
					required
					placeholder="https://example.com"
					class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
			</div>

			<div>
				<label for="add-feed-category" class="block text-sm font-medium text-n-700 mb-1">Category</label>
				<CategorySelect id="add-feed-category" bind:value={categoryId} bind:newName={newCategoryName} />
			</div>

			{#if results && results.length > 0 && (results.length > 1 || bridges.length > 0)}
				<div>
					<p class="text-xs text-n-500 mb-1">
						{results.length === 1 ? 'Found a feed:' : `Found ${results.length} feeds — pick one:`}
					</p>
					<div class="border border-n-200 rounded-md divide-y divide-n-200 max-h-64 overflow-y-auto">
						{#each results as feed (feed.url)}
							<!-- Split row: the body adds the feed, the icon opens it. An <a> cannot
							     live inside the <button>, so they sit side by side instead. -->
							<div class="flex items-stretch">
								<button
									type="button"
									onclick={() => addFeed(feed.url)}
									disabled={saving}
									class="flex-1 min-w-0 text-left px-3 py-2 hover:bg-n-100 disabled:opacity-50"
								>
									{#if feed.title && feed.title !== feed.url}
										<div class="text-sm font-medium text-n-800">{feed.title}</div>
									{/if}
									<div class="text-xs text-n-500 truncate">{feed.url}</div>
								</button>
								<a
									href={feed.url}
									target="_blank"
									rel="noopener noreferrer"
									title="Open feed in a new tab"
									aria-label="Open {feed.title || feed.url} in a new tab"
									class="flex items-center px-3 text-n-500 hover:text-a-600 hover:bg-n-100"
								>
									<ExternalLink size={14} />
								</a>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if bridges.length > 0 && onbridge}
				<div>
					<p class="text-xs text-n-500 mb-1">
						{bridges.length === 1
							? 'Your RSS-Bridge instance has a bridge for this site:'
							: `Your RSS-Bridge instance has ${bridges.length} bridges for this site:`}
					</p>
					<div class="border border-n-200 rounded-md divide-y divide-n-200 max-h-64 overflow-y-auto">
						{#each bridges as match (match.key)}
							<button
								type="button"
								onclick={() => onbridge({ bridge: match, instance, sourceUrl: feedUrl.trim() })}
								disabled={saving}
								class="w-full text-left px-3 py-2 hover:bg-n-100 disabled:opacity-50"
							>
								<div class="text-sm font-medium text-n-800">{match.name}</div>
								{#if match.description}
									<div class="text-xs text-n-500 line-clamp-2">{match.description}</div>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#if noneFound}
				<p class="text-xs text-n-500">No RSS feed found on this page.</p>
			{/if}

			<div class="flex items-center justify-between gap-2 pt-2">
				<div class="flex min-w-0 flex-col items-start gap-1">
					{#if onpagefeed && feedUrl.trim()}
						<button
							type="button"
							onclick={() =>
								onpagefeed(feedUrl.trim(), categoryId === NEW_CATEGORY_SENTINEL ? undefined : categoryId)}
							class="text-left text-xs text-a-600 underline hover:text-a-700"
						>
							{#if noneFound}
								Build a feed from the page instead
							{:else if results}
								Not the right feed? Build one from the page
							{:else}
								Or build a feed from a listing page
							{/if}
						</button>
					{/if}
					{#if instance && onwizard && results}
						<button
							type="button"
							onclick={() => onwizard(feedUrl.trim())}
							class="text-left text-xs text-n-500 underline hover:text-n-700"
						>
							…with RSS-Bridge instead
						</button>
					{/if}
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={onclose}
						class="px-4 py-2 text-sm text-n-600 hover:bg-n-100 rounded-md"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={saving || discovering || !feedUrl.trim() || needsCategoryName}
						class="px-4 py-2 text-sm bg-a-600 text-on-accent rounded-md hover:bg-a-700 disabled:opacity-50"
					>
						{saving ? 'Adding...' : discovering ? 'Searching...' : 'Add'}
					</button>
				</div>
			</div>
		</form>
	</div>
</div>
