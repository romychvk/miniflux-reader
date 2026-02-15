import { apiCall } from '$lib/api';
import { createFeedIcon } from '$lib/icons';
import type { Feed, FeedCounters, FeedIcon, FeedNode } from '$lib/types';
import { ui } from './ui.svelte';

function createFeedsStore() {
	let feedTree = $state<FeedNode[]>([]);
	let loading = $state(false);

	function applySavedOrder(tree: FeedNode[]) {
		const catOrderJson = localStorage.getItem('categoryOrder');
		const feedOrderJson = localStorage.getItem('feedOrder');

		if (catOrderJson) {
			const catOrder: number[] = JSON.parse(catOrderJson);
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

		if (feedOrderJson) {
			const feedOrder: Record<string, number[]> = JSON.parse(feedOrderJson);
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
		localStorage.setItem('categoryOrder', JSON.stringify(catOrder));

		const feedOrder: Record<string, number[]> = {};
		for (const cat of categories) {
			if (cat.children) {
				feedOrder[cat.id] = cat.children.map(f => f.id);
			}
		}
		localStorage.setItem('feedOrder', JSON.stringify(feedOrder));
	}

	async function loadFeeds() {
		loading = true;
		try {
			const [feeds, counters] = await Promise.all([
				apiCall<Feed[]>('feeds'),
				apiCall<FeedCounters>('feeds/counters')
			]);

			const unreads = counters.unreads;

			// Extract unique categories
			const categoryMap = new Map<number, string>();
			for (const f of feeds) {
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
				const catFeeds = feeds
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
			loadIcons(feeds);
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to load feeds');
		} finally {
			loading = false;
		}
	}

	async function loadIcons(feeds: Feed[]) {
		const cache: Record<string, string> = JSON.parse(
			localStorage.getItem('favicons') || '{}'
		);

		for (const feed of feeds) {
			if (!feed.icon) continue;

			const feedId = feed.id;
			let iconData: string;

			if (feedId in cache) {
				iconData = cache[feedId];
			} else {
				try {
					const icon = await apiCall<FeedIcon>(`feeds/${feedId}/icon`);
					iconData = `data:${icon.data}`;
					cache[feedId] = iconData;
					localStorage.setItem('favicons', JSON.stringify(cache));
				} catch {
					continue;
				}
			}

			// Update the feed node in tree
			for (const node of feedTree) {
				if (node.children) {
					const child = node.children.find((c) => c.id === feedId);
					if (child) child.iconData = iconData;
				}
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

	return {
		get feedTree() { return feedTree; },
		get loading() { return loading; },
		loadFeeds,
		updateCounters,
		reorderFeed,
		reorderCategory,
		moveFeedToCategory
	};
}

export const feeds = createFeedsStore();
