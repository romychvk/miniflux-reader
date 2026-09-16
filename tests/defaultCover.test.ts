import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	isDefaultCover,
	rememberDefaultCover,
	REPEAT_THRESHOLD,
	MAX_PER_FEED
} from '../src/lib/defaultCover.ts';

// The detector that keeps a site's fallback og:image off the cards (see $lib/defaultCover). It
// holds per-feed state for the whole session, so every test here uses a feed id of its own.
// Node has no localStorage — storageGet/storageSet no-op — so what these exercise is the
// in-memory tally, which is what decides whether a cover is shown.

const url = 'https://example.org/wp-content/uploads/DefaultImage.jpg';

test('a cover seen by fewer entries than the threshold is the entry’s own', () => {
	for (let i = 1; i < REPEAT_THRESHOLD; i++) {
		assert.equal(isDefaultCover(101, i, url), false, `entry ${i}`);
	}
});

test('the entry that crosses the threshold turns the cover into the feed’s default', () => {
	const learned: string[] = [];
	const onLearn = (u: string) => learned.push(u);
	for (let i = 1; i < REPEAT_THRESHOLD; i++) {
		assert.equal(isDefaultCover(102, i, url, onLearn), false);
	}
	assert.equal(isDefaultCover(102, REPEAT_THRESHOLD, url, onLearn), true);
	// The sweep over the cards already showing it has to run exactly once…
	assert.deepEqual(learned, [url]);
	// …and every later entry is answered from what was learned, without another sweep.
	assert.equal(isDefaultCover(102, 999, url, onLearn), true);
	assert.deepEqual(learned, [url]);
});

test('one entry asking repeatedly does not make its own cover a default', () => {
	// A card re-renders (and re-asks) as often as the list updates; only *distinct* entries count,
	// or every single-entry feed would lose its cover.
	for (let i = 0; i < REPEAT_THRESHOLD * 3; i++) {
		assert.equal(isDefaultCover(103, 7, url, undefined), false, `ask ${i}`);
	}
});

test('two entries and one re-render still leave the cover alone', () => {
	assert.equal(isDefaultCover(104, 1, url), false);
	assert.equal(isDefaultCover(104, 2, url), false);
	assert.equal(isDefaultCover(104, 1, url), false);
});

test('feeds tally the same url independently', () => {
	for (let i = 1; i <= REPEAT_THRESHOLD; i++) isDefaultCover(105, i, url);
	assert.equal(isDefaultCover(105, 1, url), true);
	// A second feed serving the identical URL starts from zero — the verdict is per feed, since
	// what makes the cover meaningless is that it repeats within one feed's cards.
	assert.equal(isDefaultCover(106, 1, url), false);
});

test('rememberDefaultCover suppresses a cover outright, and reports novelty once', () => {
	assert.equal(rememberDefaultCover(107, url), true);
	assert.equal(rememberDefaultCover(107, url), false); // already known — no second sweep
	assert.equal(isDefaultCover(107, 1, url), true); // no tally needed
});

test('an empty cover url is never a default', () => {
	for (let i = 1; i <= REPEAT_THRESHOLD + 1; i++) {
		assert.equal(isDefaultCover(108, i, ''), false);
	}
	assert.equal(rememberDefaultCover(108, ''), false);
});

test('the per-feed list is bounded, dropping what was learned longest ago', () => {
	for (let i = 0; i < MAX_PER_FEED + 2; i++) {
		assert.equal(rememberDefaultCover(109, `https://e.org/default-${i}.jpg`), true);
	}
	// The two oldest fell out of the list, so they read as unknown again (and would be relearned
	// from repetition if the feed still serves them)…
	assert.equal(isDefaultCover(109, 1, 'https://e.org/default-0.jpg'), false);
	assert.equal(isDefaultCover(109, 1, 'https://e.org/default-1.jpg'), false);
	// …while the rest are still known.
	assert.equal(isDefaultCover(109, 1, 'https://e.org/default-2.jpg'), true);
	assert.equal(isDefaultCover(109, 1, `https://e.org/default-${MAX_PER_FEED + 1}.jpg`), true);
});
