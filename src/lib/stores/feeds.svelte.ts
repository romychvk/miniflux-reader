import { apiCall } from '$lib/api';
import { createFeedIcon } from '$lib/icons';
import { storageGet, storageSet } from '$lib/storage';
import type { Category, Feed, FeedCounters, FeedCreate, FeedIcon, FeedNode, FeedUpdate } from '$lib/types';
import { ui } from './ui.svelte';

function createFeedsStore() {
	let feedTree = $state<FeedNode[]>([]);
	let rawFeeds = $state<Feed[]>([]);
	let loading = $state(false);

	function applySavedOrder(tree: FeedNode[]) {
		const catOrder = storageGet<number[] | null>('categoryOrder', null);
		const feedOrder = storageGet<Record<string, number[]> | null>('feedOrder', null);

		if (catOrder) {
			// Separate "All" node from categories
			const allNode = tree[0]; // id: -1
			const categories = tree.slice(1);

			categories.sort((a, b) => {
				const ai = catOrder.indexOf(a.id);
				const bi = catOrder.indexOf(b.id);
				if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
				if (ai === -1) return 1;
				if (bi === -1) return 1;
				return ai - bi;
			});

			tree.length = 0;
			tree.push(allNode, ...categories);
		}

		if (feedOrder) {
			for (const node of tree) {
				if (!node.children) continue;
				const order = feedOrder[node.id];
				if (!order) continue;
				node.children.sort((a, b) => {
					const ai = order.indexOf(a.id);
					const bi = order.indexOf(b.id);
					if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
					if (ai === -1) return 1;
					if (bi === -1) return 1;
					return ai - bi;
				});
			}
		}
	}

	function persistOrder() {
		const categories = feedTree.filter(n => n.id !== -1);
		const catOrder = categories.map(c => c.id);
		storageSet('categoryOrder', catOrder);

		const feedOrderMap: Record<string, number[]> = {};
		for (const cat of categories) {
			if (cat.children) {
				feedOrderMap[cat.id] = cat.children.map(f => f.id);
			}
		}
		storageSet('feedOrder', feedOrderMap);
	}

	async function loadFeeds() {
		loading = true;
		try {
			const [feedList, counters] = await Promise.all([
				apiCall<Feed[]>('feeds'),
				apiCall<FeedCounters>('feeds/counters')
			]);

			rawFeeds = feedList;
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
				{ id: -1, title: 'All', apiPath: 'entries', isFeed: false, unread: totalUnread }
			];

			const sortedCategories = [...categoryMap.entries()].sort((a, b) =>
				a[1].localeCompare(b[1])
			);

			for (const [catId, catTitle] of sortedCategories) {
				const catFeeds = feedList
					.filter((f) => f.category?.id === catId)
					.sort((a, b) => a.title.localeCompare(b.title))
					.map((f) => ({
						id: f.id,
						title: f.title,
						apiPath: `feeds/${f.id}/entries`,
						isFeed: true,
						iconData: createFeedIcon(f.title),
						unread: unreads[f.id] || 0
					}));

				const catUnread = catFeeds.reduce((sum, f) => sum + f.unread, 0);

				tree.push({
					id: catId,
					title: catTitle,
					apiPath: `categories/${catId}/entries`,
					isFeed: false,
					unread: catUnread,
					children: catFeeds
				});
			}

			applySavedOrder(tree);
			feedTree = tree;

			// Load icons in background
			loadIcons(feedList);
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to load feeds');
		} finally {
			loading = false;
		}
	}

	async function loadIcons(feedList: Feed[]) {
		const cache: Record<string, string> = storageGet('favicons', {});

		const feedsWithIcons = feedList.filter(f => f.icon);
		const uncachedFeeds = feedsWithIcons.filter(f => !(f.id in cache));

		// Apply cached icons immediately
		for (const feed of feedsWithIcons) {
			if (feed.id in cache) {
				applyIconToTree(feed.id, cache[feed.id]);
			}
		}

		// Fetch uncached icons in parallel
		if (uncachedFeeds.length > 0) {
			let cacheUpdated = false;
			await Promise.allSettled(
				uncachedFeeds.map(async (feed) => {
					try {
						const icon = await apiCall<FeedIcon>(`feeds/${feed.id}/icon`);
						const iconData = `data:${icon.data}`;
						cache[feed.id] = iconData;
						cacheUpdated = true;
						applyIconToTree(feed.id, iconData);
					} catch {
						// skip failed icons
					}
				})
			);

			if (cacheUpdated) {
				storageSet('favicons', cache);
			}
		}
	}

	function applyIconToTree(feedId: number, iconData: string) {
		for (const node of feedTree) {
			if (node.children) {
				const child = node.children.find((c) => c.id === feedId);
				if (child) child.iconData = iconData;
			}
		}
	}

	function updateCounters(feedId: number, delta: number) {
		for (const node of feedTree) {
			if (node.id === -1) {
				node.unread += delta;
			}
			if (node.children) {
				const child = node.children.find((c) => c.id === feedId);
				if (child) {
					child.unread += delta;
					node.unread += delta;
				}
			}
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
		persistOrder();
	}

	function reorderCategory(catId: number, newIndex: number) {
		// offset by 1 for "All" node at index 0
		const oldIndex = feedTree.findIndex(n => n.id === catId);
		if (oldIndex === -1 || oldIndex === newIndex) return;

		const [item] = feedTree.splice(oldIndex, 1);
		const adjustedIndex = oldIndex < newIndex ? newIndex - 1 : newIndex;
		feedTree.splice(adjustedIndex, 0, item);
		feedTree = [...feedTree];
		persistOrder();
	}

	async function moveFeedToCategory(feedId: number, sourceCatId: number, targetCatId: number, insertIndex: number) {
		const sourceCat = feedTree.find(n => n.id === sourceCatId);
		const targetCat = feedTree.find(n => n.id === targetCatId);
		if (!sourceCat?.children || !targetCat?.children) return;

		const feedIndex = sourceCat.children.findIndex(f => f.id === feedId);
		if (feedIndex === -1) return;

		// Optimistic update
		const [feed] = sourceCat.children.splice(feedIndex, 1);
		sourceCat.unread -= feed.unread;
		targetCat.children.splice(insertIndex, 0, feed);
		targetCat.unread += feed.unread;
		feedTree = [...feedTree];
		persistOrder();

		try {
			await apiCall(`feeds/${feedId}`, {
				method: 'PUT',
				body: JSON.stringify({ category_id: targetCatId })
			});
		} catch (e) {
			// Revert
			const revertIndex = targetCat.children.findIndex(f => f.id === feedId);
			if (revertIndex !== -1) {
				targetCat.children.splice(revertIndex, 1);
				targetCat.unread -= feed.unread;
			}
			sourceCat.children.splice(feedIndex, 0, feed);
			sourceCat.unread += feed.unread;
			feedTree = [...feedTree];
			persistOrder();
			ui.showError(e instanceof Error ? e.message : 'Failed to move feed');
		}
	}

	function getAllNode(): FeedNode | null {
		return feedTree.find(n => n.id === -1) ?? null;
	}

	function findFeedNodeById(id: number, isFeed: boolean): FeedNode | null {
		for (const node of feedTree) {
			if (node.id === id && node.isFeed === isFeed) return node;
			if (node.children) {
				for (const child of node.children) {
					if (child.id === id && child.isFeed === isFeed) return child;
				}
			}
		}
		return null;
	}

	function getRawFeed(feedId: number): Feed | null {
		return rawFeeds.find(f => f.id === feedId) ?? null;
	}

	function getCategories(): Category[] {
		return feedTree
			.filter(n => n.id !== -1 && n.children)
			.map(n => ({ id: n.id, title: n.title }));
	}

	async function createFeed(data: FeedCreate) {
		try {
			await apiCall('feeds', {
				method: 'POST',
				body: JSON.stringify(data)
			});
			await loadFeeds();
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to create feed');
			throw e;
		}
	}

	async function updateFeed(feedId: number, changes: FeedUpdate) {
		try {
			await apiCall(`feeds/${feedId}`, {
				method: 'PUT',
				body: JSON.stringify(changes)
			});

			// Update tree locally
			for (const node of feedTree) {
				if (node.children) {
					const child = node.children.find((c) => c.id === feedId);
					if (child) {
						if (changes.title) child.title = changes.title;
						break;
					}
				}
			}

			// Update rawFeeds
			const raw = rawFeeds.find(f => f.id === feedId);
			if (raw) {
				if (changes.title) raw.title = changes.title;
				if (changes.site_url) raw.site_url = changes.site_url;
				if (changes.feed_url) raw.feed_url = changes.feed_url;
				if (changes.crawler !== undefined) raw.crawler = changes.crawler;
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

	async function updateCategory(catId: number, title: string) {
		try {
			await apiCall(`categories/${catId}`, {
				method: 'PUT',
				body: JSON.stringify({ title })
			});

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
			const counters = await apiCall<FeedCounters>('feeds/counters');
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
			await apiCall(`feeds/${feedId}/refresh`, { method: 'PUT' });
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to refresh feed');
			throw e;
		}
		await loadCounters();
	}

	async function refreshCategoryFeeds(catId: number) {
		const cat = feedTree.find(n => n.id === catId);
		if (!cat?.children) return;
		const errors: string[] = [];
		await Promise.all(
			cat.children.map(async (child) => {
				try {
					await apiCall(`feeds/${child.id}/refresh`, { method: 'PUT' });
				} catch (e) {
					errors.push(child.title);
				}
			})
		);
		if (errors.length > 0) {
			ui.showError(`Failed to refresh: ${errors.join(', ')}`);
		}
		await loadCounters();
	}

	return {
		get feedTree() { return feedTree; },
		get loading() { return loading; },
		loadFeeds,
		updateCounters,
		reorderFeed,
		reorderCategory,
		moveFeedToCategory,
		getAllNode,
		findFeedNodeById,
		getRawFeed,
		getCategories,
		createFeed,
		updateFeed,
		updateCategory,
		refreshFeed,
		refreshCategoryFeeds
	};
}

export const feeds = createFeedsStore();
