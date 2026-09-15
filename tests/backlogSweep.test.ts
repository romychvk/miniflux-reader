import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsBacklogSweep, reducesUnread } from '../src/lib/backlogSweep.ts';
import type { FilterRule } from '../src/lib/contentFilter.ts';

const hideRule: FilterRule = { list: 'block', field: 'title', mode: 'contains', value: 'ad' };

test('a feed is swept once, then whenever its unread count moves', () => {
	// Never swept: worth a look only if there is something to look at.
	assert.equal(needsBacklogSweep(18, undefined), true);
	assert.equal(needsBacklogSweep(0, undefined), false);
	// Reconciled and untouched since — nothing new can be hiding in it.
	assert.equal(needsBacklogSweep(2, 2), false);
	assert.equal(needsBacklogSweep(0, 0), false);
	// New entries arrived.
	assert.equal(needsBacklogSweep(3, 2), true);
	assert.equal(needsBacklogSweep(1, 0), true);
	// Posts were read. The count has to be re-recorded, or arrivals after it would be measured
	// against the old, higher number and skipped.
	assert.equal(needsBacklogSweep(1, 2), true);
	assert.equal(needsBacklogSweep(0, 2), true);
});

test('only feeds that hide something are worth reconciling', () => {
	assert.equal(reducesUnread({ hideRules: [], dedupMode: 'off' }), false);
	assert.equal(reducesUnread({ hideRules: [hideRule], dedupMode: 'off' }), true);
	assert.equal(reducesUnread({ hideRules: [], dedupMode: 'url' }), true);
	assert.equal(reducesUnread({ hideRules: [], dedupMode: 'url-title' }), true);
	assert.equal(reducesUnread({ hideRules: [hideRule], dedupMode: 'url' }), true);
});
