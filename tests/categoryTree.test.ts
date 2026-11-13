import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Category, Feed, FeedNode } from '../src/lib/types.ts';
import {
	buildFeedTree,
	canNestUnder,
	canTakeSubcategory,
	categoryOptions,
	isGroup,
	parentMap,
	recountUnread,
	subtreeCategoryIds,
	subtreeFeeds,
	walkCategories
} from '../src/lib/categoryTree.ts';
import { applySavedOrder, persistOrder } from '../src/lib/feedOrder.ts';

// Nested categories (caps.nestedCategories, 2026-11-13): the tree the sidebar draws, what may go
// where, and the saved order over a nested tree. A Miniflux list has no parent_id and must come
// out exactly as the flat sidebar always drew it.

const feed = (id: number, title: string, category: Category): Feed => ({ id, title, category } as Feed);

function tree(categories: Category[], feeds: Feed[], unreads: Record<number, number> = {}) {
	return buildFeedTree({ categories, feeds, unreads, defaultId: 1, categoryTitle: (t) => (t === 'All' ? '— Without category —' : t), feedIcon: () => undefined });
}

const shape = (nodes: FeedNode[]): unknown[] =>
	nodes.map((n) => (n.isFeed ? `${n.title}` : n.id === -1 ? `All:${n.unread}` : { [`${n.title}:${n.unread}`]: shape(n.children ?? []) }));

test('flat (Miniflux): alphabetical, empty categories shown, an empty default hidden, unread summed', () => {
	const all = { id: 1, title: 'All' };
	const b = { id: 2, title: 'Beta' };
	const a = { id: 3, title: 'Alpha' };
	const empty = { id: 4, title: 'Empty' };
	const t = tree([all, b, a, empty], [feed(10, 'z feed', b), feed(11, 'a feed', b), feed(12, 'x', a)], { 10: 2, 11: 1, 12: 4 });
	assert.deepEqual(shape(t), ['All:7', { 'Alpha:4': ['x'] }, { 'Beta:3': ['a feed', 'z feed'] }, { 'Empty:0': [] }]);
	// The default shows once a feed is filed there, under its display title — sorted by the raw
	// title, as the flat sidebar always did.
	const t2 = tree([all, b], [feed(10, 'f', all)]);
	assert.deepEqual(shape(t2), ['All:0', { '— Without category —:0': ['f'] }, { 'Beta:0': [] }]);
	// A feed naming a category the list lacked still shows.
	assert.deepEqual(shape(tree([all], [feed(10, 'f', { id: 9, title: 'Late' })])), ['All:0', { 'Late:0': ['f'] }]);
});

test('nested: subcategories under their parent, first, and a group\'s unread is its subtree\'s', () => {
	const cats: Category[] = [
		{ id: 1, title: 'All' },
		{ id: 2, title: 'News', parent_id: null },
		{ id: 3, title: 'Forest', parent_id: 2 },
		{ id: 4, title: 'UA', parent_id: 3 },
		{ id: 5, title: 'EN', parent_id: 3 },
		{ id: 6, title: 'Solar', parent_id: 2 },
		{ id: 7, title: 'UA', parent_id: 6 }
	];
	const t = tree(cats, [feed(10, 'Ліс', cats[3]), feed(11, 'Forest news', cats[4]), feed(12, 'Сонце', cats[6])], { 10: 1, 11: 2, 12: 5 });
	assert.deepEqual(shape(t), [
		'All:8',
		{ 'News:8': [{ 'Forest:3': [{ 'EN:2': ['Forest news'] }, { 'UA:1': ['Ліс'] }] }, { 'Solar:5': [{ 'UA:5': ['Сонце'] }] }] }
	]);
	const news = t[1];
	assert.ok(isGroup(news) && !isGroup(news.children![0].children![0]));
	assert.deepEqual(walkCategories(t).map((e) => [e.path.join(' / '), e.depth, e.parentId]), [
		['News', 0, null],
		['News / Forest', 1, 2],
		['News / Forest / EN', 2, 3],
		['News / Forest / UA', 2, 3],
		['News / Solar', 1, 2],
		['News / Solar / UA', 2, 6]
	]);
	assert.deepEqual([...subtreeCategoryIds(news.children![0])].sort(), [3, 4, 5]);
	assert.deepEqual(subtreeFeeds(news).map((f) => f.id).sort(), [10, 11, 12]);
	// A feed moved by hand: recount from the leaves up.
	news.children![0].children![0].children![0].unread = 10;
	assert.equal(recountUnread(news), 16);
});

test('parentMap: a missing parent or a loop counts as the top level, never hangs', () => {
	const m = parentMap([
		{ id: 1, parent_id: 99 },
		{ id: 2, parent_id: 3 },
		{ id: 3, parent_id: 2 },
		{ id: 4, parent_id: 1 }
	]);
	assert.deepEqual([...m.entries()], [[1, null], [2, null], [3, null], [4, 1]]);
});

test('what may go where: never under the default, a category with feeds, or itself; the default stays at the top', () => {
	const cats: Category[] = [{ id: 1, title: 'All' }, { id: 2, title: 'A' }, { id: 3, title: 'B', parent_id: 2 }, { id: 4, title: 'Leaf' }];
	const t = tree(cats, [feed(10, 'f', cats[3]), feed(11, 'd', cats[0])]);
	const node = (id: number) => walkCategories(t).find((e) => e.node.id === id)!.node;
	assert.equal(canNestUnder(node(4), null, 1), true);
	assert.equal(canNestUnder(node(4), node(2), 1), true);
	assert.equal(canNestUnder(node(2), node(3), 1), false, 'under its own subcategory');
	assert.equal(canNestUnder(node(2), node(2), 1), false, 'under itself');
	assert.equal(canNestUnder(node(3), node(4), 1), false, 'under a category with feeds');
	assert.equal(canNestUnder(node(3), node(1), 1), false, 'under the default');
	assert.equal(canNestUnder(node(1), node(2), 1), false, 'the default nested');
	assert.equal(canTakeSubcategory(node(2), 1), true);
	assert.equal(canTakeSubcategory(node(4), 1), false);
	assert.equal(canTakeSubcategory(node(1), 1), false);
});

test('categoryOptions: the default first, each level alphabetical, groups and feed-holders marked', () => {
	const cats: Category[] = [
		{ id: 1, title: 'All' },
		{ id: 5, title: 'Zeta' },
		{ id: 2, title: 'News' },
		{ id: 4, title: 'UA', parent_id: 3 },
		{ id: 3, title: 'Forest', parent_id: 2 },
		{ id: 6, title: 'Alpha', parent_id: 2 }
	];
	const opts = categoryOptions(cats, { defaultId: 1, title: (t) => (t === 'All' ? '— Without category —' : t), withFeeds: new Set([4, 5]) });
	assert.deepEqual(
		opts.map((o) => [o.title, o.depth, o.group, o.holdsFeeds]),
		[
			['— Without category —', 0, false, false],
			['News', 0, true, false],
			['Alpha', 1, false, false],
			['Forest', 1, true, false],
			['UA', 2, false, true],
			['Zeta', 0, false, true]
		]
	);
});

test('saved order: one depth-first id list sorts every level; feeds keep their own order', () => {
	const store = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	};
	try {
		const cats: Category[] = [{ id: 1, title: 'All' }, { id: 2, title: 'News' }, { id: 3, title: 'B', parent_id: 2 }, { id: 4, title: 'A', parent_id: 2 }, { id: 5, title: 'Other' }];
		const make = () => tree(cats, [feed(10, 'a', cats[1 + 1]), feed(11, 'b', cats[1 + 1])]);
		const t = make();
		// Hand order: Other before News, B before A, feed b before a.
		const news = t.find((n) => n.id === 2)!;
		const other = t.find((n) => n.id === 5)!;
		t.splice(1, t.length - 1, other, news);
		news.children!.reverse(); // B, A
		const b = news.children!.find((n) => n.id === 3)!;
		b.children!.reverse(); // b, a
		persistOrder(t);
		assert.deepEqual(JSON.parse(store.get('categoryOrder')!), [5, 2, 3, 4]);
		const again = make();
		applySavedOrder(again);
		assert.deepEqual(shape(again), ['All:0', { 'Other:0': [] }, { 'News:0': [{ 'B:0': ['b', 'a'] }, { 'A:0': [] }] }]);
	} finally {
		delete (globalThis as { localStorage?: unknown }).localStorage;
	}
});
