import type { Category, Feed, FeedNode } from '$lib/types';

// Categories as a tree. A backend with caps.nestedCategories gives each category a parent_id;
// Miniflux gives none, and the tree is the flat list it always was. Pure: the feeds store builds
// the sidebar with it, and the pickers and the drag-and-drop ask it what may go where.
//
// The shape everything relies on: a category node's children are its subcategories first, then
// its feeds. A category with subcategories is a group and holds no feeds — the server refuses a
// feed there — but a node that has both still renders, subcategories first.

// Each category's parent, safe to walk: a parent missing from the list, or one that would close a
// loop, counts as the top level. The server refuses both; this keeps a stale or partial list from
// hanging the sidebar.
export function parentMap(categories: Pick<Category, 'id' | 'parent_id'>[]): Map<number, number | null> {
	const ids = new Set(categories.map((c) => c.id));
	const raw = new Map(categories.map((c) => [c.id, c.parent_id != null && ids.has(c.parent_id) ? c.parent_id : null]));
	const out = new Map<number, number | null>();
	for (const c of categories) {
		const seen = new Set([c.id]);
		let p = raw.get(c.id) ?? null;
		let loop = false;
		while (p !== null) {
			if (seen.has(p)) {
				loop = true;
				break;
			}
			seen.add(p);
			p = raw.get(p) ?? null;
		}
		out.set(c.id, loop ? null : (raw.get(c.id) ?? null));
	}
	return out;
}

export interface FeedTreeInput {
	categories: Category[];
	feeds: Feed[];
	unreads: Record<number, number>;
	// The default category (Miniflux's "All"): an empty one is only the account's built-in bucket,
	// so it shows once a feed is filed there. Every other category shows, empty or not.
	defaultId: number | null;
	categoryTitle: (title: string) => string;
	feedIcon: (feed: Feed) => string | undefined;
}

// The sidebar's tree: the synthetic "All" node (id -1) first, then the top-level categories. Each
// level is alphabetical; the saved order (feedOrder.ts) is laid over it afterwards.
export function buildFeedTree(input: FeedTreeInput): FeedNode[] {
	const cats = new Map<number, Category>();
	for (const c of input.categories) cats.set(c.id, c);
	// A feed may name a category the list did not carry (a race with a create); it still shows.
	for (const f of input.feeds) if (f.category && !cats.has(f.category.id)) cats.set(f.category.id, { id: f.category.id, title: f.category.title });
	const parents = parentMap([...cats.values()]);

	const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
	const feedsOf = new Map<number, FeedNode[]>();
	for (const f of [...input.feeds].sort(byTitle)) {
		if (!f.category) continue;
		const list = feedsOf.get(f.category.id) ?? feedsOf.set(f.category.id, []).get(f.category.id)!;
		list.push({ id: f.id, title: f.title, scope: { kind: 'feed', id: f.id }, isFeed: true, iconData: input.feedIcon(f), unread: input.unreads[f.id] || 0 });
	}
	const subsOf = new Map<number | null, Category[]>();
	for (const c of [...cats.values()].sort(byTitle)) {
		const p = parents.get(c.id) ?? null;
		(subsOf.get(p) ?? subsOf.set(p, []).get(p)!).push(c);
	}

	const node = (c: Category): FeedNode | null => {
		const subs = (subsOf.get(c.id) ?? []).map(node).filter((n): n is FeedNode => n !== null);
		const own = feedsOf.get(c.id) ?? [];
		if (c.id === input.defaultId && subs.length === 0 && own.length === 0) return null;
		const children = [...subs, ...own];
		return {
			id: c.id,
			title: input.categoryTitle(c.title),
			scope: { kind: 'category', id: c.id },
			isFeed: false,
			unread: children.reduce((sum, n) => sum + n.unread, 0),
			children
		};
	};
	const top = (subsOf.get(null) ?? []).map(node).filter((n): n is FeedNode => n !== null);
	const totalUnread = Object.values(input.unreads).reduce((sum, n) => sum + n, 0);
	return [{ id: -1, title: 'All', scope: { kind: 'all' }, isFeed: false, unread: totalUnread }, ...top];
}

export interface CategoryOption {
	id: number;
	title: string;
	depth: number;
	parentId: number | null;
	// Has subcategories: a group, which takes no feeds.
	group: boolean;
	// Holds feeds: takes no subcategories.
	holdsFeeds: boolean;
}

// Every category the way a picker lists it: the default category first, then the tree, each
// level alphabetical and a subcategory right under its parent. Alphabetical rather than the
// sidebar's saved order, so a flat list reads the way it always did.
export function categoryOptions(
	categories: Category[],
	opts: { defaultId: number | null; title: (title: string) => string; withFeeds: Set<number> }
): CategoryOption[] {
	const parents = parentMap(categories);
	const subsOf = new Map<number | null, Category[]>();
	for (const c of categories) {
		const p = parents.get(c.id) ?? null;
		(subsOf.get(p) ?? subsOf.set(p, []).get(p)!).push(c);
	}
	const out: CategoryOption[] = [];
	const visit = (parentId: number | null, depth: number) => {
		const level = (subsOf.get(parentId) ?? [])
			.map((c) => ({ c, title: opts.title(c.title) }))
			.sort((a, b) => {
				if (a.c.id === opts.defaultId) return -1;
				if (b.c.id === opts.defaultId) return 1;
				return a.title.localeCompare(b.title);
			});
		for (const { c, title } of level) {
			out.push({ id: c.id, title, depth, parentId, group: (subsOf.get(c.id)?.length ?? 0) > 0, holdsFeeds: opts.withFeeds.has(c.id) });
			visit(c.id, depth + 1);
		}
	};
	visit(null, 0);
	return out;
}

export const isCategoryNode = (n: FeedNode) => !n.isFeed && n.id > 0;

// A group: a category with subcategories, which holds no feeds of its own.
export function isGroup(node: FeedNode): boolean {
	return node.children?.some(isCategoryNode) ?? false;
}

export function holdsFeeds(node: FeedNode): boolean {
	return node.children?.some((c) => c.isFeed) ?? false;
}

export interface CategoryEntry {
	node: FeedNode;
	depth: number;
	parentId: number | null;
	// Titles from the top level down to this one.
	path: string[];
}

// Every category node, depth-first in sidebar order.
export function walkCategories(tree: FeedNode[]): CategoryEntry[] {
	const out: CategoryEntry[] = [];
	const visit = (nodes: FeedNode[], depth: number, parentId: number | null, path: string[]) => {
		for (const n of nodes) {
			if (!isCategoryNode(n)) continue;
			const p = [...path, n.title];
			out.push({ node: n, depth, parentId, path: p });
			if (n.children) visit(n.children, depth + 1, n.id, p);
		}
	};
	visit(tree, 0, null, []);
	return out;
}

// The category and every category under it.
export function subtreeCategoryIds(node: FeedNode): Set<number> {
	const ids = new Set<number>();
	const visit = (n: FeedNode) => {
		ids.add(n.id);
		for (const c of n.children ?? []) if (isCategoryNode(c)) visit(c);
	};
	visit(node);
	return ids;
}

// Every feed in the category and under it.
export function subtreeFeeds(node: FeedNode): FeedNode[] {
	const out: FeedNode[] = [];
	const visit = (n: FeedNode) => {
		for (const c of n.children ?? []) {
			if (c.isFeed) out.push(c);
			else if (isCategoryNode(c)) visit(c);
		}
	};
	visit(node);
	return out;
}

// Recount a category's unread from its feeds up, after feeds or categories moved under it.
export function recountUnread(node: FeedNode): number {
	if (node.isFeed || !node.children) return node.unread;
	node.unread = node.children.reduce((sum, c) => sum + recountUnread(c), 0);
	return node.unread;
}

// May `child` go under `parent` (null = the top level)? Not under the default category, not under
// one that holds feeds, not under itself or anything below it; the default category itself stays
// at the top level. The same rules the engine enforces, asked first so the UI never offers a move
// the server would refuse.
export function canNestUnder(child: FeedNode, parent: FeedNode | null, defaultId: number | null): boolean {
	if (parent === null) return true;
	if (child.id === defaultId || parent.id === defaultId) return false;
	if (holdsFeeds(parent)) return false;
	return !subtreeCategoryIds(child).has(parent.id);
}

// May `parent` take a new, empty subcategory?
export function canTakeSubcategory(parent: FeedNode, defaultId: number | null): boolean {
	return parent.id !== defaultId && !holdsFeeds(parent);
}
