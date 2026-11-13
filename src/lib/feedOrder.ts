import { storageGet, storageSet } from '$lib/storage';
import type { FeedNode } from '$lib/types';

// Read/write pair for the user's saved sidebar order (localStorage 'categoryOrder' + 'feedOrder').
// Extracted from the feeds store; pure tree/storage manipulation with no reactive state.
//
// 'categoryOrder' is one list of category ids, depth-first: every level of a nested tree is
// sorted by it, so a subcategory keeps its place among its siblings and a flat tree reads it the
// way it always did. 'feedOrder' maps a category id to its feeds' ids.

const isCategory = (n: FeedNode) => !n.isFeed && n.id > 0;

function byOrder(order: number[]) {
	return (a: FeedNode, b: FeedNode) => {
		const ai = order.indexOf(a.id);
		const bi = order.indexOf(b.id);
		if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
		if (ai === -1) return 1;
		if (bi === -1) return -1;
		return ai - bi;
	};
}

// Reorder a freshly-built feed tree in place to match the saved order. Unknown ids fall to the
// end of their level, alphabetical among themselves. The "All" node (id -1) is pinned at index 0;
// within a category, its subcategories stay ahead of its feeds.
export function applySavedOrder(tree: FeedNode[]) {
	const catOrder = storageGet<number[] | null>('categoryOrder', null);
	const feedOrder = storageGet<Record<string, number[]> | null>('feedOrder', null);

	if (catOrder) {
		// Separate "All" node from categories
		const allNode = tree[0]; // id: -1
		const categories = tree.slice(1);
		categories.sort(byOrder(catOrder));
		tree.length = 0;
		tree.push(allNode, ...categories);
	}

	const visit = (node: FeedNode) => {
		if (!node.children) return;
		const subs = node.children.filter(isCategory);
		const own = node.children.filter((n) => n.isFeed);
		if (catOrder) subs.sort(byOrder(catOrder));
		const order = feedOrder?.[node.id];
		if (order) own.sort(byOrder(order));
		node.children.splice(0, node.children.length, ...subs, ...own);
		for (const s of subs) visit(s);
	};
	for (const node of tree) if (isCategory(node)) visit(node);
}

// Persist the current category order (depth-first) and per-category feed order to localStorage.
export function persistOrder(feedTree: FeedNode[]) {
	const catOrder: number[] = [];
	const feedOrderMap: Record<string, number[]> = {};
	const visit = (nodes: FeedNode[]) => {
		for (const n of nodes) {
			if (!isCategory(n) || !n.children) continue;
			catOrder.push(n.id);
			feedOrderMap[n.id] = n.children.filter((c) => c.isFeed).map((f) => f.id);
			visit(n.children);
		}
	};
	visit(feedTree);
	storageSet('categoryOrder', catOrder);
	storageSet('feedOrder', feedOrderMap);
}
