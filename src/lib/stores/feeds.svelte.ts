import { backend } from '$lib/backend';
import { categoryDisplayTitle } from '$lib/category';
import { createFeedIcon } from '$lib/icons';
import { storageGet, storageSet } from '$lib/storage';
import type { Category, Feed, FeedCreate, FeedNode, FeedUpdate } from '$lib/types';
import { mapPool } from '$lib/pool';
import { applySavedOrder, persistOrder } from '$lib/feedOrder';
import { ui } from './ui.svelte';

// Cap the icon and refresh fan-outs (category and all-feeds) so a big account doesn't fire
// one request per feed at once — icon fetches hammer the proxy and refreshes make Miniflux
// crawl every source in parallel. 6 is within the audited 4–8 band.
const FEED_REQUEST_CONCURRENCY = 6;

function createFeedsStore() {
	let feedTree = $state<FeedNode[]>([]);
	let rawFeeds = $state<Feed[]>([]);
	let rawCategories = $state<Category[]>([]);
	let loading = $state(false);
	let abortController: AbortController | null = null;

	// O(1) lookup indexes: feedId → FeedNode, feedId → parent category node
	let feedIndex = new Map<number, FeedNode>();
	let parentIndex = new Map<number, FeedNode>();

	function rebuildFeedIndex() {
		feedIndex = new Map();
		parentIndex = new Map();
		for (const node of feedTree) {
			if (node.children) {
				for (const child of node.children) {
					feedIndex.set(child.id, child);
					parentIndex.set(child.id, node);
				}
			}
		}
	}

	async function loadFeeds() {
		abortController?.abort();
		abortController = new AbortController();
		const signal = abortController.signal;

		loading = true;
		try {
			const [feedList, counters, catList] = await Promise.all([
				backend().listFeeds(signal),
				backend().counters(signal),
				backend().listCategories(signal)
			]);

			rawFeeds = feedList;
			rawCategories = catList;
			const unreads = counters.unreads;

			// Extract unique categories
			const categoryMap = new Map<number, string>();
			for (const f of feedList) {
				if (f.category && !categoryMap.has(f.category.id)) {
					categoryMap.set(f.category.id, f.category.title);
				}
			}

			// Build tree
			const totalUnread = Object.values(unreads).reduce((sum, n) => sum + n, 0);

			const tree: FeedNode[] = [
				{ id: -1, title: 'All', scope: { kind: 'all' }, isFeed: false, unread: totalUnread }
			];

			const sortedCategories = [...categoryMap.entries()].sort((a, b) =>
				a[1].localeCompare(b[1])
			);

			for (const [catId, catTitle] of sortedCategories) {
				const catFeeds = feedList
					.filter((f) => f.category?.id === catId)
					.sort((a, b) => a.title.localeCompare(b.title))
					.map((f): FeedNode => ({
						id: f.id,
						title: f.title,
						scope: { kind: 'feed', id: f.id },
						isFeed: true,
						iconData: createFeedIcon(f.title),
						unread: unreads[f.id] || 0
					}));

				const catUnread = catFeeds.reduce((sum, f) => sum + f.unread, 0);

				tree.push({
					id: catId,
					title: categoryDisplayTitle(catTitle),
					scope: { kind: 'category', id: catId },
					isFeed: false,
					unread: catUnread,
					children: catFeeds
				});
			}

			applySavedOrder(tree);
			feedTree = tree;
			rebuildFeedIndex();

			// Load icons in background
			loadIcons(feedList, signal);
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			ui.showError(e instanceof Error ? e.message : 'Failed to load feeds');
		} finally {
			if (!signal.aborted) loading = false;
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
			if (parent) parent.unread += delta;
		}
	}

	function reorderFeed(catId: number, feedId: number, newIndex: number) {
		const cat = feedTree.find(n => n.id === catId);
		if (!cat?.children) return;

		const oldIndex = cat.children.findIndex(f => f.id === feedId);
		if (oldIndex === -1 || oldIndex === newIndex) return;

		const [item] = cat.children.splice(oldIndex, 1);
		// Adjust index if we removed before the target
		const adjustedIndex = oldIndex < newIndex ? newIndex - 1 : newIndex;
		cat.children.splice(adjustedIndex, 0, item);
		feedTree = [...feedTree];
		rebuildFeedIndex();
		persistOrder(feedTree);
	}

	// Locale-aware, case-insensitive, numbers in natural order ("Feed 2" before "Feed 10").
	function sortFeedsAlphabetically(catId: number) {
		const cat = feedTree.find(n => n.id === catId);
		if (!cat?.children || cat.children.length < 2) return;

		cat.children.sort((a, b) =>
			a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })
		);
		feedTree = [...feedTree];
		rebuildFeedIndex();
		persistOrder(feedTree);
	}

	function reorderCategory(catId: number, newIndex: number) {
		// offset by 1 for "All" node at index 0
		const oldIndex = feedTree.findIndex(n => n.id === catId);
		if (oldIndex === -1 || oldIndex === newIndex) return;

		const [item] = feedTree.splice(oldIndex, 1);
		const adjustedIndex = oldIndex < newIndex ? newIndex - 1 : newIndex;
		feedTree.splice(adjustedIndex, 0, item);
		feedTree = [...feedTree];
		rebuildFeedIndex();
		persistOrder(feedTree);
	}

	async function moveFeedToCategory(feedId: number, sourceCatId: number, targetCatId: number, insertIndex: number) {
		const sourceCat = feedTree.find(n => n.id === sourceCatId);
		const targetCat = feedTree.find(n => n.id === targetCatId);
		if (!sourceCat?.children || !targetCat?.children) return;

		const feedIdx = sourceCat.children.findIndex(f => f.id === feedId);
		if (feedIdx === -1) return;

		// Optimistic update
		const [feed] = sourceCat.children.splice(feedIdx, 1);
		sourceCat.unread -= feed.unread;
		targetCat.children.splice(insertIndex, 0, feed);
		targetCat.unread += feed.unread;
		feedTree = [...feedTree];
		rebuildFeedIndex();
		persistOrder(feedTree);

		try {
			await backend().updateFeed(feedId, { category_id: targetCatId });
		} catch (e) {
			// Revert
			const revertIndex = targetCat.children.findIndex(f => f.id === feedId);
			if (revertIndex !== -1) {
				targetCat.children.splice(revertIndex, 1);
				targetCat.unread -= feed.unread;
			}
			sourceCat.children.splice(feedIdx, 0, feed);
			sourceCat.unread += feed.unread;
			feedTree = [...feedTree];
			rebuildFeedIndex();
			persistOrder(feedTree);
			ui.showError(e instanceof Error ? e.message : 'Failed to move feed');
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
		// Category or "All" node — small list, linear scan is fine
		return feedTree.find(n => n.id === id && n.isFeed === isFeed) ?? null;
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

	async function createCategory(title: string): Promise<Category> {
		try {
			const cat = await backend().createCategory(title);
			await loadFeeds();
			return cat;
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to create category');
			throw e;
		}
	}

	async function createFeed(data: FeedCreate): Promise<number | undefined> {
		try {
			const res = await backend().createFeed(data);
			await loadFeeds();
			return res?.feed_id;
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to create feed');
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
			ui.showError(e instanceof Error ? e.message : 'Failed to update feed');
			throw e;
		}
	}

	async function deleteFeed(feedId: number) {
		try {
			await backend().deleteFeed(feedId);
			await loadFeeds();
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to unsubscribe from feed');
			throw e;
		}
	}

	async function updateCategory(catId: number, title: string) {
		try {
			await backend().updateCategory(catId, title);

			// Update tree locally
			const cat = feedTree.find(n => n.id === catId);
			if (cat) cat.title = title;

			// Re-select if selected
			if (ui.selectedFeed && !ui.selectedFeed.isFeed && ui.selectedFeed.id === catId) {
				const updated = findFeedNodeById(catId, false);
				if (updated) ui.selectFeed(updated);
			}
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to update category');
			throw e;
		}
	}

	async function loadCounters() {
		try {
			const counters = await backend().counters();
			const unreads = counters.unreads;
			let totalUnread = 0;
			for (const node of feedTree) {
				if (node.id === -1) continue;
				if (node.children) {
					let catUnread = 0;
					for (const child of node.children) {
						child.unread = unreads[child.id] || 0;
						catUnread += child.unread;
					}
					node.unread = catUnread;
					totalUnread += catUnread;
				}
			}
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
			ui.showError(e instanceof Error ? e.message : 'Failed to refresh feed');
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

	async function refreshCategoryFeeds(catId: number) {
		const cat = feedTree.find(n => n.id === catId);
		if (!cat?.children) return;
		await refreshFeedList(cat.children);
	}

	return {
		get feedTree() { return feedTree; },
		get rawFeeds() { return rawFeeds; },
		get loading() { return loading; },
		loadFeeds,
		setFeedIcon,
		updateCounters,
		reorderFeed,
		sortFeedsAlphabetically,
		reorderCategory,
		moveFeedToCategory,
		allFeedNodes,
		getAllNode,
		getStarredNode,
		findFeedNodeById,
		getRawFeed,
		getCategories,
		getNoCategoryId,
		createCategory,
		createFeed,
		updateFeed,
		deleteFeed,
		updateCategory,
		loadCounters,
		refreshFeed,
		refreshAllFeeds,
		refreshCategoryFeeds
	};
}

export const feeds = createFeedsStore();
