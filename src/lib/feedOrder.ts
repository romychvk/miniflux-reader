import { storageGet, storageSet } from '$lib/storage';
import type { FeedNode } from '$lib/types';

// Read/write pair for the user's saved sidebar order (localStorage 'categoryOrder' + 'feedOrder').
// Extracted from the feeds store; pure tree/storage manipulation with no reactive state.

// Reorder a freshly-built feed tree in place to match the saved order. Unknown ids fall to the
// end, alphabetical among themselves. The "All" node (id -1) is pinned at index 0.
export function applySavedOrder(tree: FeedNode[]) {
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
			if (bi === -1) return -1;
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
				if (bi === -1) return -1;
				return ai - bi;
			});
		}
	}
}

// Persist the current category order and per-category feed order to localStorage.
export function persistOrder(feedTree: FeedNode[]) {
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
