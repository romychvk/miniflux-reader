import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeEntries, asDedupMode, type DedupMode } from '../src/lib/dedup.ts';
import type { Entry, Feed } from '../src/lib/types.ts';

function makeEntry(o: {
	id?: number;
	feedId?: number;
	title?: string;
	url?: string;
	status?: 'unread' | 'read';
} = {}): Entry {
	const feed: Feed = {
		id: o.feedId ?? 1,
		title: 'F',
		site_url: '',
		feed_url: '',
		category: { id: 1, title: 'C' }
	};
	return {
		id: o.id ?? 1,
		title: o.title ?? '',
		url: o.url ?? '',
		author: '',
		content: '',
		status: o.status ?? 'unread',
		starred: false,
		published_at: '2026-01-01T00:00:00Z',
		feed
	};
}

const always = (mode: DedupMode) => () => mode;

test('asDedupMode accepts only the known modes', () => {
	assert.equal(asDedupMode('url'), 'url');
	assert.equal(asDedupMode('url-title'), 'url-title');
	assert.equal(asDedupMode('off'), 'off');
	assert.equal(asDedupMode('nonsense'), 'off');
	assert.equal(asDedupMode(null), 'off');
});

test("mode 'off' passes every entry through", () => {
	const list = [makeEntry({ id: 1, url: 'a' }), makeEntry({ id: 2, url: 'a' })];
	assert.equal(dedupeEntries(list, always('off')).length, 2);
});

test("mode 'url' collapses same-URL dups in a feed and keeps the unread copy", () => {
	const list = [
		makeEntry({ id: 1, url: 'https://x/a', status: 'read' }),
		makeEntry({ id: 2, url: 'https://x/a', status: 'unread' }),
		makeEntry({ id: 3, url: 'https://x/b', status: 'unread' })
	];
	const out = dedupeEntries(list, always('url'));
	assert.equal(out.length, 2);
	assert.equal(out.find((e) => e.url === 'https://x/a')?.id, 2); // unread copy won
});

test("mode 'url' never merges across feeds", () => {
	const list = [
		makeEntry({ id: 1, url: 'https://x/a', feedId: 1 }),
		makeEntry({ id: 2, url: 'https://x/a', feedId: 2 })
	];
	assert.equal(dedupeEntries(list, always('url')).length, 2);
});

test("mode 'url-title' also collapses entries that share a title (case-insensitive)", () => {
	const list = [
		makeEntry({ id: 1, url: 'https://x/a', title: 'Same Release' }),
		makeEntry({ id: 2, url: 'https://x/b', title: 'same release' })
	];
	assert.equal(dedupeEntries(list, always('url-title')).length, 1);
	// url-only keeps both (different URLs)
	assert.equal(dedupeEntries(list, always('url')).length, 2);
});

test('per-feed mode: different feeds can use different dedup modes', () => {
	const list = [
		makeEntry({ id: 1, feedId: 1, url: 'https://x/a', status: 'read' }),
		makeEntry({ id: 2, feedId: 1, url: 'https://x/a', status: 'unread' }),
		makeEntry({ id: 3, feedId: 2, url: 'https://y/a' }),
		makeEntry({ id: 4, feedId: 2, url: 'https://y/a' })
	];
	const out = dedupeEntries(list, (feedId) => (feedId === 1 ? 'url' : 'off'));
	assert.equal(out.length, 3); // feed 1 collapsed to 1, feed 2 kept both
});
