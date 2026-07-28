import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	POLL_INTERVAL_MS,
	computeNewCount,
	formatRefreshResult,
	isStale,
	shouldPoll,
	type PollGuards
} from '../src/lib/refreshLogic.ts';

test('computeNewCount is the unread delta, clamped at zero', () => {
	assert.equal(computeNewCount(5, 9), 4);
	assert.equal(computeNewCount(5, 5), 0);
	// Counters can shrink (entries read on another device mid-refresh).
	assert.equal(computeNewCount(9, 5), 0);
	assert.equal(computeNewCount(0, 1), 1);
});

test('formatRefreshResult labels the count', () => {
	assert.equal(formatRefreshResult(4), '+4 new');
	assert.equal(formatRefreshResult(1), '+1 new');
	assert.equal(formatRefreshResult(0), 'No new');
});

test('isStale flips exactly at the interval boundary', () => {
	const t0 = 1_000_000;
	assert.equal(isStale(t0, t0 + POLL_INTERVAL_MS - 1, POLL_INTERVAL_MS), false);
	assert.equal(isStale(t0, t0 + POLL_INTERVAL_MS, POLL_INTERVAL_MS), true);
	assert.equal(isStale(t0, t0 + POLL_INTERVAL_MS * 3, POLL_INTERVAL_MS), true);
});

test('shouldPoll requires every guard to pass', () => {
	const ok: PollGuards = {
		hidden: false,
		refreshing: false,
		entriesLoading: false,
		loggedIn: true,
		hasTree: true
	};
	assert.equal(shouldPoll(ok), true);
	assert.equal(shouldPoll({ ...ok, hidden: true }), false);
	assert.equal(shouldPoll({ ...ok, refreshing: true }), false);
	assert.equal(shouldPoll({ ...ok, entriesLoading: true }), false);
	assert.equal(shouldPoll({ ...ok, loggedIn: false }), false);
	assert.equal(shouldPoll({ ...ok, hasTree: false }), false);
});
