import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	PAGE_FEED_PATH,
	canonicalPageFeedQuery,
	decodePageFeedParams,
	encodePageFeedParams,
	isPageFeedUrl,
	pageFeedConfigKey,
	parsePageFeedUrl,
	type PageFeedConfig
} from '../src/lib/pageFeed.ts';

const FULL: PageFeedConfig = {
	pageUrl: 'https://www.creativebloq.com/tag/indesign',
	itemSelector: 'article',
	mode: 'sections',
	titlePattern: '\(version',
	urlPattern: '^https://www\\.creativebloq\\.com/',
	limit: 25,
	titleSelector: 'h3.article-name',
	dateSelector: 'time[datetime]',
	summarySelector: 'p.synopsis',
	imageSelector: 'figure img'
};

test('encode drops empty optionals and trims', () => {
	const params = encodePageFeedParams({
		pageUrl: '  https://example.com/news  ',
		itemSelector: ' article ',
		urlPattern: '',
		titleSelector: '   ',
		limit: undefined
	});
	assert.deepEqual(params, { u: 'https://example.com/news', s: 'article' });
});

test('encode → decode round-trips every field', () => {
	const decoded = decodePageFeedParams(encodePageFeedParams(FULL));
	assert.deepEqual(decoded, FULL);
});

// The compatibility guarantee for every page feed signed before the mode key existed: a cards
// config still encodes to exactly the keys it always did, so its canonical query — and therefore
// its signature and its dirty-tracking key — are unchanged.
test('card mode is never written to the wire', () => {
	const cards = encodePageFeedParams({ pageUrl: 'https://example.com', itemSelector: 'article', mode: 'cards' });
	assert.deepEqual(cards, { u: 'https://example.com', s: 'article' });
	const sections = encodePageFeedParams({ pageUrl: 'https://example.com', itemSelector: 'h2', mode: 'sections' });
	assert.deepEqual(sections, { u: 'https://example.com', s: 'h2', m: 'sections' });
});

test('decode rejects an unreadable mode rather than falling back to cards', () => {
	assert.equal(decodePageFeedParams({ u: 'https://example.com', s: 'h2', m: 'bogus' }), null);
	// An explicit 'cards' is accepted (nothing mints it, but a hand-edited URL may carry it) and
	// leaves mode unset, which is what 'cards' means.
	assert.deepEqual(decodePageFeedParams({ u: 'https://example.com', s: 'article', m: 'cards' }), {
		pageUrl: 'https://example.com',
		itemSelector: 'article'
	});
	assert.deepEqual(decodePageFeedParams({ u: 'https://example.com', s: 'article', m: '' }), {
		pageUrl: 'https://example.com',
		itemSelector: 'article'
	});
});

test('decode rejects missing required keys and bad limits', () => {
	assert.equal(decodePageFeedParams({ u: 'https://example.com' }), null);
	assert.equal(decodePageFeedParams({ s: 'article' }), null);
	assert.equal(decodePageFeedParams({ u: 'https://example.com', s: 'article', n: '0' }), null);
	assert.equal(decodePageFeedParams({ u: 'https://example.com', s: 'article', n: 'ten' }), null);
	assert.equal(decodePageFeedParams({ u: 'https://example.com', s: 'article', n: '1000' }), null);
	assert.deepEqual(decodePageFeedParams({ u: 'https://example.com', s: 'article', n: '' }), {
		pageUrl: 'https://example.com',
		itemSelector: 'article'
	});
});

test('canonical query is order-independent and ignores unknown keys', () => {
	const a = canonicalPageFeedQuery({ s: 'article', u: 'https://example.com/a b', n: '5' });
	const b = canonicalPageFeedQuery({ n: '5', u: 'https://example.com/a b', s: 'article', foo: 'bar' });
	assert.equal(a, b);
	assert.equal(a, 'n=5&s=article&u=https%3A%2F%2Fexample.com%2Fa+b');
});

test('isPageFeedUrl recognises our shape on any origin, rejects everything else', () => {
	const ours = `https://microrss.zina.run${PAGE_FEED_PATH}?u=https%3A%2F%2Fexample.com&s=article&sig=abc`;
	assert.equal(isPageFeedUrl(ours), true);
	assert.equal(isPageFeedUrl(`http://localhost:5173${PAGE_FEED_PATH}?s=article&u=x&sig=abc`), true);
	assert.equal(isPageFeedUrl(`https://microrss.zina.run${PAGE_FEED_PATH}?u=x&s=article`), false); // unsigned
	assert.equal(isPageFeedUrl('https://bridge.example.com/?action=display&bridge=CssSelectorBridge&home_page=x'), false);
	assert.equal(isPageFeedUrl('https://www.creativebloq.com/feeds.xml'), false);
	assert.equal(isPageFeedUrl('not a url'), false);
});

test('parsePageFeedUrl decodes the config from a signed URL', () => {
	const query = canonicalPageFeedQuery(encodePageFeedParams(FULL));
	const url = `https://microrss.zina.run${PAGE_FEED_PATH}?${query}&sig=whatever`;
	assert.deepEqual(parsePageFeedUrl(url), FULL);
	assert.equal(parsePageFeedUrl('https://www.creativebloq.com/feeds.xml'), null);
});

test('pageFeedConfigKey ignores whitespace and empty optionals', () => {
	const a = pageFeedConfigKey({ pageUrl: 'https://example.com', itemSelector: 'article' });
	const b = pageFeedConfigKey({
		pageUrl: ' https://example.com ',
		itemSelector: 'article ',
		urlPattern: '',
		summarySelector: '  '
	});
	assert.equal(a, b);
	assert.notEqual(a, pageFeedConfigKey({ pageUrl: 'https://example.com', itemSelector: 'li' }));
	assert.equal(pageFeedConfigKey(null), '');
});
