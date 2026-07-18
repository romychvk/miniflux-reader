import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMatchers, isEntryHidden, asFilterAction } from '../src/lib/filterHide.ts';
import type { FilterRule } from '../src/lib/contentFilter.ts';
import type { Entry, Feed } from '../src/lib/types.ts';

function makeEntry(o: {
	title?: string;
	content?: string;
	url?: string;
	author?: string;
	status?: 'unread' | 'read';
	feedId?: number;
	id?: number;
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
		author: o.author ?? '',
		content: o.content ?? '',
		status: o.status ?? 'unread',
		starred: false,
		published_at: '2026-01-01T00:00:00Z',
		feed
	};
}

const rule = (o: Partial<FilterRule>): FilterRule => ({
	list: 'block',
	field: 'title',
	mode: 'contains',
	value: '',
	...o
});

test('asFilterAction defaults to block for anything but "mark-read"', () => {
	assert.equal(asFilterAction('mark-read'), 'mark-read');
	assert.equal(asFilterAction('block'), 'block');
	assert.equal(asFilterAction('garbage'), 'block');
	assert.equal(asFilterAction(null), 'block');
	assert.equal(asFilterAction(undefined), 'block');
});

test('a block rule hides a matching entry (case-insensitive contains, scoped to its field)', () => {
	const m = compileMatchers([rule({ list: 'block', field: 'title', mode: 'contains', value: 'Sponsored' })]);
	assert.equal(isEntryHidden(makeEntry({ title: 'A SPONSORED post' }), m), true);
	assert.equal(isEntryHidden(makeEntry({ title: 'Real news' }), m), false);
	// the rule targets title, so a match in another field must not hide the entry
	assert.equal(isEntryHidden(makeEntry({ content: 'sponsored' }), m), false);
});

test('keep rules hide everything that does not match at least one of them', () => {
	const m = compileMatchers([rule({ list: 'keep', field: 'title', mode: 'contains', value: 'Rust' })]);
	assert.equal(isEntryHidden(makeEntry({ title: 'Rust 2.0 released' }), m), false); // kept
	assert.equal(isEntryHidden(makeEntry({ title: 'Go news' }), m), true); // no keep match → hidden
});

test('block wins; empty values and uncompilable regex are dropped', () => {
	const m = compileMatchers([
		rule({ list: 'block', field: 'url', mode: 'regex', value: 'ads\\.example' }),
		rule({ list: 'keep', field: 'title', mode: 'contains', value: '   ' }), // empty → dropped
		rule({ list: 'block', field: 'title', mode: 'regex', value: '(' }) // invalid regex → dropped
	]);
	assert.equal(m.block.length, 1);
	assert.equal(m.keep.length, 0);
	assert.equal(isEntryHidden(makeEntry({ url: 'https://ads.example/x' }), m), true);
	assert.equal(isEntryHidden(makeEntry({ url: 'https://ok.example/x' }), m), false);
});

test('no rules hides nothing', () => {
	const m = compileMatchers([]);
	assert.equal(isEntryHidden(makeEntry({ title: 'anything at all' }), m), false);
});
