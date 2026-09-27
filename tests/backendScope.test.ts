import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entriesPath, markAllReadPath } from '../src/lib/backend/minifluxPaths.ts';
import { feedIdOf } from '../src/lib/backend/scope.ts';

test('entriesPath addresses each scope the way the reader always did', () => {
	assert.equal(
		entriesPath({ kind: 'all' }, { status: 'unread', limit: 100 }),
		'entries?status=unread&order=published_at&direction=desc&limit=100'
	);
	assert.equal(
		entriesPath({ kind: 'feed', id: 7 }, { status: 'unread', limit: 100 }),
		'feeds/7/entries?status=unread&order=published_at&direction=desc&limit=100'
	);
	assert.equal(
		entriesPath({ kind: 'category', id: 3 }, { limit: 100 }),
		'categories/3/entries?order=published_at&direction=desc&limit=100'
	);
	// Bookmarks are a flag on the plain collection, so the query continues with `&`.
	assert.equal(
		entriesPath({ kind: 'starred' }, { limit: 100 }),
		'entries?starred=true&order=published_at&direction=desc&limit=100'
	);
});

test('entriesPath carries search, paging and an explicit order', () => {
	assert.equal(
		entriesPath({ kind: 'feed', id: 7 }, { search: 'a b&c', status: 'unread', limit: 50, offset: 100 }),
		'feeds/7/entries?search=a%20b%26c&status=unread&order=published_at&direction=desc&limit=50&offset=100'
	);
	// A zero offset is the default and stays off the wire.
	assert.equal(
		entriesPath({ kind: 'all' }, { limit: 1, offset: 0, direction: 'asc' }),
		'entries?order=published_at&direction=asc&limit=1'
	);
});

test('markAllReadPath needs the user only for the All view', () => {
	assert.equal(markAllReadPath({ kind: 'all' }, 42), 'users/42/mark-all-as-read');
	assert.equal(markAllReadPath({ kind: 'feed', id: 7 }, 42), 'feeds/7/mark-all-as-read');
	assert.equal(markAllReadPath({ kind: 'category', id: 3 }, 42), 'categories/3/mark-all-as-read');
});

test('feedIdOf names the feed of a single-feed scope and nothing else', () => {
	assert.equal(feedIdOf({ kind: 'feed', id: 7 }), 7);
	assert.equal(feedIdOf({ kind: 'category', id: 7 }), null);
	assert.equal(feedIdOf({ kind: 'all' }), null);
	assert.equal(feedIdOf({ kind: 'starred' }), null);
});
