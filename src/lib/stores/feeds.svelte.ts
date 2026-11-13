import { backend } from '$lib/backend';
import { categoryDisplayTitle } from '$lib/category';
import { createFeedIcon } from '$lib/icons';
import { storageGet, storageSet } from '$lib/storage';
import type { Category, Feed, FeedCreate, FeedNode, FeedUpdate } from '$lib/types';
import { mapPool } from '$lib/pool';
import { applySavedOrder, persistOrder } from '$lib/feedOrder';
import {
	buildFeedTree,
	categoryOptions as listCategoryOptions,
	canNestUnder,
	canTakeSubcategory,
	isCategoryNode,
	isGroup,
	recountUnread,
	subtreeCategoryIds,
	subtreeFeeds,
	walkCategories,
	type CategoryEntry,
	type CategoryOption
} from '$lib/categoryTree';
import { ui } from './ui.svelte';

// Cap the icon and refresh fan-outs (category and all-feeds) so a big account doesn't fire
// one request per feed at once — icon fetches hammer the proxy and refreshes make Miniflux
// crawl every source in parallel. 6 is within the audited 4–8 band.
const FEED_REQUEST_CONCURRENCY = 6;

function createFeedsStore() {
	let feedTree = $state<FeedNode[]>([]);
	let rawFeeds = $state<Feed[]>([]);
	let rawCategories = $state<Category[]>([]);
	let abortController: AbortController | null = null;

	// O(1) lookup indexes: feedId → FeedNode, feedId → its category node, categoryId → its node,
	// categoryId → the category it sits under (null at the top level). Categories nest
	// (caps.nestedCategories), so every walk below goes through these, never feedTree's top level.
	let feedIndex = new Map<number, FeedNode>();
	let parentIndex = new Map<number, FeedNode>();
	let catIndex = new Map<number, FeedNode>();
	let catParent = new Map<number, FeedNode | null>();

	function rebuildFeedIndex() {
		feedIndex = new Map();
		parentIndex = new Map();
		catIndex = new Map();
		catParent = new Map();
		const visit = (node: FeedNode, parent: FeedNode | null) => {
			catIndex.set(node.id, node);
			catParent.set(node.id, parent);
			for (const child of node.children ?? []) {
				if (child.isFeed) {
					feedIndex.set(child.id, child);
					parentIndex.set(child.id, node);
				} else if (isCategoryNode(child)) visit(child, node);
			}
		};
		for (const node of feedTree) if (isCategoryNode(node)) visit(node, null);
	}

	// The category and every category above it, nearest first.
	function ancestry(catId: number): FeedNode[] {
		const out: FeedNode[] = [];
		for (let n = catIndex.get(catId) ?? null; n; n = catParent.get(n.id) ?? null) out.push(n);
		return out;
	}

	async function loadFeeds() {
		abortController?.abort();
		abortController = new AbortController();
		const signal = abortController.signal;

		try {
			const [feedList, counters, catList] = await Promise.all([
				backend().listFeeds(signal),
				backend().counters(signal),
				backend().listCategories(signal)
			]);

			rawFeeds = feedList;
			rawCategories = catList;
			const unreads = counters.unreads;

			// Every category, empty ones too (a category just made with Add Category holds nothing
			// until a feed is dropped onto it), nested under its parent — except an empty default
			// category, which is only the account's built-in bucket ($lib/categoryTree).
			const tree = buildFeedTree({
				categories: catList,
				feeds: feedList,
				unreads,
				defaultId: getNoCategoryId(),
				categoryTitle: categoryDisplayTitle,
				feedIcon: (f) => createFeedIcon(f.title)
			});

			applySavedOrder(tree);
			feedTree = tree;
			rebuildFeedIndex();

			// Load icons in background
			loadIcons(feedList, signal);
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			ui.showCaught(e, 'Failed to load feeds');
		}
	}

	async function loadIcons(feedList: Feed[], signal: AbortSignal) {
		const cache: Record<string, string> = storageGet('favicons', {});

		const feedsWithIcons = feedList.filter(f => f.icon);
		const uncachedFeeds = feedsWithIcons.filter(f => !(f.id in cache));

		// Apply cached icons immediately
		for (const feed of feedsWithIcons) {
			if (feed.id in cache) {
				applyIconToTree(feed.id, cache[feed.id]);
			}
		}

		// Fetch uncached icons with bounded concurrency
		if (uncachedFeeds.length > 0) {
			let cacheUpdated = false;
			await mapPool(uncachedFeeds, FEED_REQUEST_CONCURRENCY, async (feed) => {
				if (signal.aborted) return;
				try {
					const icon = await backend().feedIcon(feed.id, signal);
					const iconData = `data:${icon.data}`;
					cache[feed.id] = iconData;
					cacheUpdated = true;
					applyIconToTree(feed.id, iconData);
				} catch {
					// skip failed icons
				}
			});

			if (cacheUpdated && !signal.aborted) {
				storageSet('favicons', cache);
			}
		}
	}

	function applyIconToTree(feedId: number, iconData: string) {
		const child = feedIndex.get(feedId);
		if (child) child.iconData = iconData;
	}

	// Override a feed's sidebar icon and persist it into the favicons cache, so the choice
	// survives reloads (loadIcons reapplies the cached value and skips re-fetching the
	// site favicon). Used to swap github feeds' generic octocat for the release-author avatar.
	function setFeedIcon(feedId: number, iconData: string) {
		const child = feedIndex.get(feedId);
		if (child) child.iconData = iconData;
		const cache: Record<string, string> = storageGet('favicons', {});
		if (cache[feedId] !== iconData) {
			cache[feedId] = iconData;
			storageSet('favicons', cache);
		}
	}

	function updateCounters(feedId: number, delta: number) {
		const allNode = feedTree[0]; // id: -1
		if (allNode) allNode.unread += delta;

		const child = feedIndex.get(feedId);
		if (child) {
			child.unread += delta;
			const parent = parentIndex.get(feedId);
			if (parent) for (const cat of ancestry(parent.id)) cat.unread += delta;
		}
	}

	// After an order change: a fresh array so the sidebar re-renders, the indexes rebuilt over it,
	// the order saved.
	function commitOrder() {
		feedTree = [...feedTree];
		rebuildFeedIndex();
		persistOrder(feedTree);
	}

	function reorderFeed(catId: number, feedId: number, newIndex: number) {
		const cat = catIndex.get(catId);
		if (!cat?.children) return;

		const oldIndex = cat.children.findIndex(f => f.id === feedId);
		if (oldIndex === -1 || oldIndex === newIndex) return;

		const [item] = cat.children.splice(oldIndex, 1);
		// Adjust index if we removed before the target
		const adjustedIndex = oldIndex < newIndex ? newIndex - 1 : newIndex;
		cat.children.splice(adjustedIndex, 0, item);
		commitOrder();
	}

	// Locale-aware, case-insensitive, numbers in natural order ("Feed 2" before "Feed 10").
	function sortFeedsAlphabetically(catId: number) {
		const cat = catIndex.get(catId);
		if (cat && isGroup(cat)) return;
		if (!cat?.children || cat.children.length < 2) return;

		cat.children.sort((a, b) =>
			a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })
		);
		commitOrder();
	}

	// Recount every category's unread from its feeds — after a feed or a category changed places.
	function recountAll() {
		for (const node of feedTree) if (isCategoryNode(node)) recountUnread(node);
	}

	// Put a category under `parentId` (null = the top level), before or after a sibling, or last
	// among its new siblings. Within one parent it is only the saved order; a new parent is a
	// server move too (caps.nestedCategories), and a refused one reloads the tree as the server has
	// it. The caller asks canNest first; this re-checks so a stale drop can never break the tree.
	async function placeCategory(catId: number, parentId: number | null, anchor: { before: number } | { after: number } | null = null) {
		const node = catIndex.get(catId);
		const from = catParent.get(catId) ?? null;
		const to = parentId === null ? null : (catIndex.get(parentId) ?? null);
		if (!node || (parentId !== null && !to)) return;
		const moving = (from?.id ?? null) !== parentId;
		if (moving && (!backend().caps.nestedCategories || !canNestUnder(node, to, getNoCategoryId()))) return;

		const fromList = from ? from.children! : feedTree;
		fromList.splice(fromList.findIndex((n) => !n.isFeed && n.id === catId), 1);
		const toList = to ? to.children! : feedTree;
		let at = toList.length;
		if (anchor) {
			const anchorId = 'before' in anchor ? anchor.before : anchor.after;
			const i = toList.findIndex((n) => !n.isFeed && n.id === anchorId);
			if (i !== -1) at = 'before' in anchor ? i : i + 1;
		} else if (to) {
			// Last among the subcategories, ahead of any feeds.
			at = toList.filter(isCategoryNode).length;
		}
		toList.splice(at, 0, node);
		recountAll();
		commitOrder();

		if (!moving) return;
		try {
			await backend().moveCategory!(catId, parentId);
			const raw = rawCategories.find((c) => c.id === catId);
			if (raw) raw.parent_id = parentId;
		} catch (e) {
			ui.showCaught(e, 'Failed to move category');
			await loadFeeds();
		}
	}

	async function moveFeedToCategory(feedId: number, sourceCatId: number, targetCatId: number, insertIndex: number) {
		const sourceCat = catIndex.get(sourceCatId);
		const targetCat = catIndex.get(targetCatId);
		if (!sourceCat?.children || !targetCat?.children || isGroup(targetCat)) return;

		const feedIdx = sourceCat.children.findIndex(f => f.isFeed && f.id === feedId);
		if (feedIdx === -1) return;

		// Optimistic update
		const [feed] = sourceCat.children.splice(feedIdx, 1);
		targetCat.children.splice(insertIndex, 0, feed);
		recountAll();
		commitOrder();

		try {
			await backend().updateFeed(feedId, { category_id: targetCatId });
		} catch (e) {
			// Revert
			const revertIndex = targetCat.children.findIndex(f => f.isFeed && f.id === feedId);
			if (revertIndex !== -1) targetCat.children.splice(revertIndex, 1);
			sourceCat.children.splice(feedIdx, 0, feed);
			recountAll();
			commitOrder();
			ui.showCaught(e, 'Failed to move feed');
		}
	}

	// Every feed node in the tree, categories and pseudo-feeds excluded — for passes that have
	// to walk all of them (the background hide-rule sweep).
	function allFeedNodes(): FeedNode[] {
		return [...feedIndex.values()];
	}

	function getAllNode(): FeedNode | null {
		return feedTree.find(n => n.id === -1) ?? null;
	}

	// Bookmarks pseudo-feed (Miniflux "starred"). Kept OUT of feedTree on purpose:
	// the ordering/DnD/counter code hard-assumes feedTree[0] is the "All" node, so
	// FeedTree.svelte renders this constant directly instead. Miniflux has no
	// starred counter, so it never shows an unread badge.
	const STARRED_NODE: FeedNode = {
		id: -2,
		title: 'Bookmarks',
		scope: { kind: 'starred' },
		isFeed: false,
		unread: 0
	};

	function getStarredNode(): FeedNode {
		return STARRED_NODE;
	}

	function findFeedNodeById(id: number, isFeed: boolean): FeedNode | null {
		if (isFeed) return feedIndex.get(id) ?? null;
		if (id === -1) return getAllNode();
		return catIndex.get(id) ?? null;
	}

	// The category a category sits under; null at the top level (and for an unknown id).
	function parentIdOf(catId: number): number | null {
		return catParent.get(catId)?.id ?? null;
	}

	// Every category in sidebar order with its depth and path — the pickers' list (CategorySelect,
	// the parent picker) and the other places that pick a category.
	function categoryEntries(): CategoryEntry[] {
		return walkCategories(feedTree);
	}

	// Every category as the pickers list it — the default first, then the tree alphabetically,
	// each with its depth, whether it is a group and whether it holds feeds.
	function categoryOptions(): CategoryOption[] {
		return listCategoryOptions(rawCategories, {
			defaultId: getNoCategoryId(),
			title: categoryDisplayTitle,
			withFeeds: new Set(rawFeeds.map((f) => f.category?.id).filter((id): id is number => id !== undefined))
		});
	}

	// The category and every category under it (just itself when it is not in the tree).
	function subtreeIdsOf(catId: number): Set<number> {
		const node = catIndex.get(catId);
		return node ? subtreeCategoryIds(node) : new Set([catId]);
	}

	// May this category go under that one (null = the top level)? The engine's rules, asked
	// before a drop or a save is offered ($lib/categoryTree).
	function canNest(catId: number, parentId: number | null): boolean {
		const node = catIndex.get(catId);
		if (!node) return false;
		if (parentId === null) return true;
		const parent = catIndex.get(parentId);
		return !!parent && backend().caps.nestedCategories && canNestUnder(node, parent, getNoCategoryId());
	}

	function canAddSubcategory(catId: number): boolean {
		const node = catIndex.get(catId);
		return !!node && backend().caps.nestedCategories && canTakeSubcategory(node, getNoCategoryId());
	}

	// A sibling under that parent already has this title: the server would refuse a rename or a
	// move there, and answer a create with the existing one. Raw titles, as the server compares.
	function categoryTitleTaken(title: string, parentId: number | null, exceptId?: number): boolean {
		return rawCategories.some((c) => c.id !== exceptId && (c.parent_id ?? null) === parentId && c.title === title);
	}

	function getRawFeed(feedId: number): Feed | null {
		return rawFeeds.find(f => f.id === feedId) ?? null;
	}

	// Sourced from the authoritative Miniflux category list (includes empty and
	// newly-created categories), relabeled for display, with "— Without category —"
	// pinned first and the rest alphabetical.
	function getCategories(): Category[] {
		const defaultId = getNoCategoryId();
		return rawCategories
			.map(c => ({ id: c.id, title: categoryDisplayTitle(c.title) }))
			.sort((a, b) => {
				if (a.id === defaultId) return -1;
				if (b.id === defaultId) return 1;
				return a.title.localeCompare(b.title);
			});
	}

	// Id of Miniflux's default category (the "no category" bucket), used to sort it
	// first and to default the Add Feed picker. Miniflux creates it with the account
	// titled "All", so it's the lowest-id category — and that stays true even if the
	// user renames it (e.g. to "Uncategorized"), which a title match would miss.
	function getNoCategoryId(): number | null {
		if (rawCategories.length === 0) return null;
		return rawCategories.reduce((min, c) => (c.id < min.id ? c : min)).id;
	}

	async function createCategory(title: string, parentId: number | null = null): Promise<Category> {
		try {
			const cat = await backend().createCategory(title, parentId);
			await loadFeeds();
			return cat;
		} catch (e) {
			ui.showCaught(e, 'Failed to create category');
			throw e;
		}
	}

	async function createFeed(data: FeedCreate): Promise<number | undefined> {
		try {
			const res = await backend().createFeed(data);
			await loadFeeds();
			return res?.feed_id;
		} catch (e) {
			ui.showCaught(e, 'Failed to create feed');
			throw e;
		}
	}

	async function updateFeed(feedId: number, changes: FeedUpdate) {
		try {
			await backend().updateFeed(feedId, changes);

			// Update tree locally
			const child = feedIndex.get(feedId);
			if (child && changes.title) {
				child.title = changes.title;
			}

			// Update rawFeeds
			const raw = rawFeeds.find(f => f.id === feedId);
			if (raw) {
				if (changes.title) raw.title = changes.title;
				if (changes.site_url) raw.site_url = changes.site_url;
				if (changes.feed_url) raw.feed_url = changes.feed_url;
				if (changes.crawler !== undefined) raw.crawler = changes.crawler;
				if (changes.scraper_rules !== undefined) raw.scraper_rules = changes.scraper_rules;
				if (changes.rewrite_rules !== undefined) raw.rewrite_rules = changes.rewrite_rules;
				if (changes.blocklist_rules !== undefined) raw.blocklist_rules = changes.blocklist_rules;
				if (changes.keeplist_rules !== undefined) raw.keeplist_rules = changes.keeplist_rules;
				if (changes.block_filter_entry_rules !== undefined) raw.block_filter_entry_rules = changes.block_filter_entry_rules;
				if (changes.keep_filter_entry_rules !== undefined) raw.keep_filter_entry_rules = changes.keep_filter_entry_rules;
				if (changes.disabled !== undefined) raw.disabled = changes.disabled;
				if (changes.ignore_http_cache !== undefined) raw.ignore_http_cache = changes.ignore_http_cache;
				if (changes.user_agent !== undefined) raw.user_agent = changes.user_agent;
			}

			// Handle category change — needs full reload since tree structure changes
			if (changes.category_id) {
				await loadFeeds();
			}

			// Re-select feed if it was selected
			if (ui.selectedFeed?.isFeed && ui.selectedFeed.id === feedId) {
				const updated = findFeedNodeById(feedId, true);
				if (updated) ui.selectFeed(updated);
			}
		} catch (e) {
			ui.showCaught(e, 'Failed to update feed');
			throw e;
		}
	}

	async function deleteFeed(feedId: number) {
		try {
			await backend().deleteFeed(feedId);
			await loadFeeds();
		} catch (e) {
			ui.showCaught(e, 'Failed to unsubscribe from feed');
			throw e;
		}
	}

	async function updateCategory(catId: number, title: string) {
		try {
			await backend().updateCategory(catId, title);

			// Update tree locally
			const cat = catIndex.get(catId);
			if (cat) cat.title = title;
			const raw = rawCategories.find((c) => c.id === catId);
			if (raw) raw.title = title;

			// Re-select if selected
			if (ui.selectedFeed && !ui.selectedFeed.isFeed && ui.selectedFeed.id === catId) {
				const updated = findFeedNodeById(catId, false);
				if (updated) ui.selectFeed(updated);
			}
		} catch (e) {
			ui.showCaught(e, 'Failed to update category');
			throw e;
		}
	}

	// Edit Category's save: a new title, a new parent (null = the top level), either or both. A
	// moved category goes last among its new siblings.
	async function editCategory(catId: number, title: string, parentId: number | null) {
		const raw = rawCategories.find((c) => c.id === catId);
		if (raw && raw.title !== title && categoryDisplayTitle(raw.title) !== title) await updateCategory(catId, title);
		if (parentId !== parentIdOf(catId)) await placeCategory(catId, parentId);
	}

	async function loadCounters() {
		try {
			const counters = await backend().counters();
			const unreads = counters.unreads;
			for (const [id, feed] of feedIndex) feed.unread = unreads[id] || 0;
			let totalUnread = 0;
			for (const node of feedTree) if (isCategoryNode(node)) totalUnread += recountUnread(node);
			const allNode = feedTree.find(n => n.id === -1);
			if (allNode) allNode.unread = totalUnread;
		} catch {
			// silently fail — counters will update on next full reload
		}
	}

	async function refreshFeed(feedId: number) {
		try {
			await backend().refreshFeed(feedId);
		} catch (e) {
			ui.showCaught(e, 'Failed to refresh feed');
			throw e;
		}
		await loadCounters();
	}

	// Fan out per-feed synchronous refreshes: refreshFeed blocks until the feed is crawled, so
	// after the pool drains the counters are trustworthy and a "+N new" count can be honest.
	// (Miniflux's bulk refresh endpoint is async server-side, which is why there is no bulk
	// operation on the backend interface.)
	async function refreshFeedList(list: { id: number; title: string }[]) {
		const errors: string[] = [];
		await mapPool(list, FEED_REQUEST_CONCURRENCY, async (feed) => {
			try {
				await backend().refreshFeed(feed.id);
			} catch {
				errors.push(feed.title);
			}
		});
		if (errors.length > 0) {
			ui.showError(`Failed to refresh: ${errors.join(', ')}`);
		}
		await loadCounters();
	}

	async function refreshAllFeeds() {
		// A disabled feed is not crawled (Miniflux refuses outright) — skip them instead of toasting.
		await refreshFeedList(rawFeeds.filter(f => !f.disabled));
	}

	// A group's feeds are its subcategories', at any depth.
	async function refreshCategoryFeeds(catId: number) {
		const cat = catIndex.get(catId);
		if (!cat) return;
		await refreshFeedList(subtreeFeeds(cat));
	}

	return {
		get feedTree() { return feedTree; },
		get rawFeeds() { return rawFeeds; },
		loadFeeds,
		setFeedIcon,
		updateCounters,
		reorderFeed,
		sortFeedsAlphabetically,
		placeCategory,
		moveFeedToCategory,
		allFeedNodes,
		getAllNode,
		getStarredNode,
		findFeedNodeById,
		getRawFeed,
		getCategories,
		getNoCategoryId,
		parentIdOf,
		categoryEntries,
		categoryOptions,
		subtreeIdsOf,
		canNest,
		canAddSubcategory,
		categoryTitleTaken,
		createCategory,
		createFeed,
		updateFeed,
		deleteFeed,
		updateCategory,
		editCategory,
		loadCounters,
		refreshFeed,
		refreshAllFeeds,
		refreshCategoryFeeds
	};
}

export const feeds = createFeedsStore();
