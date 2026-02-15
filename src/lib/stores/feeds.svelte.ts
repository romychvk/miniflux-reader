import { apiCall } from '$lib/api';
import { createFeedIcon } from '$lib/icons';
import type { Feed, FeedCounters, FeedIcon, FeedNode } from '$lib/types';
import { ui } from './ui.svelte';

function createFeedsStore() {
	let feedTree = $state<FeedNode[]>([]);
	let loading = $state(false);

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

	return {
		get feedTree() { return feedTree; },
		get loading() { return loading; },
		loadFeeds,
		updateCounters
	};
}

export const feeds = createFeedsStore();
