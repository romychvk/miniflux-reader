import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildSignedPageFeedPath,
	parseSignedQuery,
	signPageFeedParams,
	verifyPageFeedSignature
} from '../src/lib/server/pageFeed/sign.ts';
import { PAGE_FEED_PATH, parsePageFeedUrl } from '../src/lib/pageFeed.ts';

const SECRET = 'test-secret-0123456789abcdef';
const CONFIG = {
	pageUrl: 'https://www.creativebloq.com/tag/indesign',
	itemSelector: 'article',
	limit: 20
};

test('sign is order-independent and secret-dependent', () => {
	const a = signPageFeedParams({ u: 'https://example.com', s: 'article', n: '5' }, SECRET);
	const b = signPageFeedParams({ n: '5', s: 'article', u: 'https://example.com' }, SECRET);
	assert.equal(a, b);
	assert.match(a, /^[A-Za-z0-9_-]{43}$/); // base64url sha256, no padding
	assert.notEqual(a, signPageFeedParams({ u: 'https://example.com', s: 'article', n: '5' }, 'other'));
});

test('verify accepts the real signature and rejects tampering', () => {
	const params = { u: 'https://example.com', s: 'article' };
	const sig = signPageFeedParams(params, SECRET);
	assert.equal(verifyPageFeedSignature(params, sig, SECRET), true);
	assert.equal(verifyPageFeedSignature({ ...params, s: 'li' }, sig, SECRET), false);
	assert.equal(verifyPageFeedSignature({ ...params, n: '5' }, sig, SECRET), false);
	assert.equal(verifyPageFeedSignature(params, sig, 'other-secret'), false);
	// A flipped character, a wrong length and empties must all fail without throwing.
	const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
	assert.equal(verifyPageFeedSignature(params, flipped, SECRET), false);
	assert.equal(verifyPageFeedSignature(params, sig.slice(0, 10), SECRET), false);
	assert.equal(verifyPageFeedSignature(params, '', SECRET), false);
	assert.equal(verifyPageFeedSignature(params, sig, ''), false);
});

test('buildSignedPageFeedPath → parseSignedQuery → verify round-trips', () => {
	const path = buildSignedPageFeedPath(CONFIG, SECRET);
	assert.ok(path.startsWith(`${PAGE_FEED_PATH}?`));
	const url = new URL(path, 'https://microrss.zina.run');
	const parsed = parseSignedQuery(url.searchParams);
	assert.ok(parsed);
	assert.equal(verifyPageFeedSignature(parsed.params, parsed.sig, SECRET), true);
	assert.deepEqual(parsePageFeedUrl(url.toString()), CONFIG);
});

test('parseSignedQuery is strict about unknown, repeated and missing keys', () => {
	const path = buildSignedPageFeedPath(CONFIG, SECRET);
	const base = new URL(path, 'https://microrss.zina.run');

	const unknown = new URL(base.toString());
	unknown.searchParams.append('foo', '1');
	assert.equal(parseSignedQuery(unknown.searchParams), null);

	const repeated = new URL(base.toString());
	repeated.searchParams.append('u', 'https://evil.example');
	assert.equal(parseSignedQuery(repeated.searchParams), null);

	const unsigned = new URL(base.toString());
	unsigned.searchParams.delete('sig');
	assert.equal(parseSignedQuery(unsigned.searchParams), null);
});

test('re-encoding by a client does not break verification', () => {
	// Miniflux or a browser may re-serialize the query (e.g. %20 vs +); the canonical form absorbs it.
	const params = { u: 'https://example.com/a b?x=1&y=2', s: 'div.card > a' };
	const sig = signPageFeedParams(params, SECRET);
	const sp = new URLSearchParams();
	sp.set('sig', sig);
	sp.set('s', params.s);
	sp.set('u', params.u);
	const reparsed = new URLSearchParams(sp.toString().replace(/\+/g, '%20'));
	const parsed = parseSignedQuery(reparsed);
	assert.ok(parsed);
	assert.equal(verifyPageFeedSignature(parsed.params, parsed.sig, SECRET), true);
});
