import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	InvalidPatternError,
	InvalidSelectorError,
	extractItems,
	parsePage,
	suggestSelectors
} from '../src/lib/server/pageFeed/extract.ts';

const BASE = 'https://www.creativebloq.com/tag/indesign';

// Modelled on creativebloq.com/tag/indesign: the <a> wraps the whole <article>, dates sit in a
// byline paragraph, and the CMS leaves a SPONSORED_HEADLINE template card in the markup.
function card(opts: { slug: string; title: string; date?: string; synopsis?: string; img?: string }): string {
	// A leading slash keeps the href relative — the extractor must resolve it against the page.
	const href = opts.slug.startsWith('/') ? opts.slug : `https://www.creativebloq.com/design/${opts.slug}`;
	return `
<a class="article-link" href="${href}" aria-label="${opts.title}">
	<article aria-label="Search result: ${opts.title}" class="search-result">
		<div class="image"><figure class="article-lead-image-wrap">
			${opts.img ? `<img src="${opts.img}" alt="lead" srcset="${opts.img} 320w">` : ''}
		</figure></div>
		<div class="content">
			<header>
				<h3 class="article-name">${opts.title}</h3>
				<p class="byline"><span class="by-author">By Tom May</span> Published
					${opts.date ? `<time datetime="${opts.date}" class="relative-date">12 March 26</time>` : ''}
				</p>
			</header>
			${opts.synopsis ? `<p class="synopsis"> ${opts.synopsis} </p>` : ''}
		</div>
	</article>
</a>`;
}

const PAGE = `<!doctype html><html><head><title>InDesign | Creative Bloq</title></head><body>
<nav><ul>
	<li><a href="/">Home</a></li>
	<li><a href="/design">Design</a></li>
	<li><a href="#top">Top</a></li>
	<li><a href="mailto:hi@example.com">Mail</a></li>
</ul></nav>
<main>
<!-- The page-level article wraps the whole listing, as on creativebloq.com: it matches the
     "article" selector too, but it is a wrapper, not an item. -->
<article class="landing-article">
<h1>InDesign</h1>
<h2>Latest about InDesign</h2>
<div class="listingResults">
${card({ slug: 'this-niche-indesign-issue', title: 'This niche Adobe InDesign issue should be a warning to all creatives', date: '2026-03-12T11:00:00Z', synopsis: 'Real-world experience', img: 'https://cdn.example.com/a.jpg' })}
${card({ slug: 'indesign-alternatives', title: 'InDesign logo and alternatives including Affinity & Quark', date: '2026-01-15T16:08:07Z', synopsis: 'The best alternatives.' })}
${card({ slug: '/features/download-adobe-indesign', title: 'Want to download InDesign?', synopsis: 'Learn how to download InDesign as a free trial or subscription.' })}
${card({ slug: 'SPONSORED_URL', title: 'SPONSORED_HEADLINE' })}
</div>
</article>
<section class="cards">
	<div class="card">
		<a class="thumb" href="/news/inner-link"><img src="/img/inner.png" alt=""></a>
		<h2><a href="/news/inner-link">Inner link card &lt;strong&gt;</a></h2>
		<p>Some other paragraph that is long enough to be a summary.</p>
	</div>
	<div class="card">
		<a class="thumb" href="https://www.creativebloq.com/news/second-card"><img data-src="//cdn.example.com/lazy.png" alt=""></a>
		<h2><a href="https://www.creativebloq.com/news/second-card">Second card</a></h2>
	</div>
</section>
</main>
</body></html>`;

test('article cards: link via enclosing <a>, title from heading, date/synopsis/image from the card', () => {
	const { items, matched, pageTitle } = extractItems(parsePage(PAGE), BASE, { itemSelector: 'article' });
	assert.equal(pageTitle, 'InDesign | Creative Bloq');
	assert.equal(matched, 5, 'the wrapper <article> counts as a match…');
	assert.equal(items.length, 3, '…but yields no item, and the SPONSORED_HEADLINE placeholder is dropped');
	assert.deepEqual(items[0], {
		url: 'https://www.creativebloq.com/design/this-niche-indesign-issue',
		title: 'This niche Adobe InDesign issue should be a warning to all creatives',
		date: '2026-03-12T11:00:00.000Z',
		summary: 'Real-world experience',
		image: 'https://cdn.example.com/a.jpg'
	});
	assert.equal(items[1].title, 'InDesign logo and alternatives including Affinity & Quark');
	assert.equal(items[1].date, '2026-01-15T16:08:07.000Z');
	assert.equal(items[1].image, undefined);
	// Third card has no date — kept, just undated; relative href resolved against the page.
	assert.equal(items[2].url, 'https://www.creativebloq.com/features/download-adobe-indesign');
	assert.equal(items[2].date, undefined);
	assert.equal(items[2].summary, 'Learn how to download InDesign as a free trial or subscription.');
});

test('a heading selector resolves the same links through closest() and scopes to the card', () => {
	const { items } = extractItems(parsePage(PAGE), BASE, { itemSelector: 'article h3' });
	assert.deepEqual(
		items.map((i) => i.url),
		[
			'https://www.creativebloq.com/design/this-niche-indesign-issue',
			'https://www.creativebloq.com/design/indesign-alternatives',
			'https://www.creativebloq.com/features/download-adobe-indesign'
		]
	);
	assert.equal(items[0].date, '2026-03-12T11:00:00.000Z');
	assert.equal(items[0].summary, 'Real-world experience');
});

test('anchor selectors: dedupe by URL, skip # and mailto:, lazy image attributes, HTML entities', () => {
	const { items } = extractItems(parsePage(PAGE), BASE, { itemSelector: '.card a' });
	assert.equal(items.length, 2);
	assert.equal(items[0].url, 'https://www.creativebloq.com/news/inner-link');
	// The thumbnail link matched first; the title comes from the card heading, not the empty <a>.
	assert.equal(items[0].title, 'Inner link card <strong>');
	assert.equal(items[0].summary, 'Some other paragraph that is long enough to be a summary.');
	assert.equal(items[0].image, 'https://www.creativebloq.com/img/inner.png');
	assert.equal(items[1].image, 'https://cdn.example.com/lazy.png');

	const nav = extractItems(parsePage(PAGE), BASE, { itemSelector: 'nav a' });
	assert.deepEqual(
		nav.items.map((i) => i.url),
		['https://www.creativebloq.com/', 'https://www.creativebloq.com/design']
	);
});

test('urlPattern filters, limit truncates in page order', () => {
	const $ = parsePage(PAGE);
	const filtered = extractItems($, BASE, { itemSelector: 'article', urlPattern: '/features/' });
	assert.deepEqual(
		filtered.items.map((i) => i.url),
		['https://www.creativebloq.com/features/download-adobe-indesign']
	);
	const limited = extractItems($, BASE, { itemSelector: 'article', limit: 2 });
	assert.equal(limited.items.length, 2);
	assert.equal(limited.items[1].url, 'https://www.creativebloq.com/design/indesign-alternatives');
});

test('explicit sub-selectors override the heuristics', () => {
	const { items } = extractItems(parsePage(PAGE), BASE, {
		itemSelector: 'article',
		titleSelector: 'p.synopsis',
		dateSelector: 'time',
		summarySelector: 'h3',
		imageSelector: 'figure'
	});
	assert.equal(items[0].title, 'Real-world experience');
	assert.equal(items[0].summary, 'This niche Adobe InDesign issue should be a warning to all creatives');
	assert.equal(items[0].image, 'https://cdn.example.com/a.jpg');
	// titleSelector that matches nothing yields no title → item dropped rather than mislabeled
	const none = extractItems(parsePage(PAGE), BASE, { itemSelector: 'article', titleSelector: '.nope' });
	assert.equal(none.items.length, 0);
});

test('invalid selector and invalid pattern are distinct errors', () => {
	const $ = parsePage(PAGE);
	assert.throws(() => extractItems($, BASE, { itemSelector: 'article[' }), InvalidSelectorError);
	assert.throws(() => extractItems($, BASE, { itemSelector: '   ' }), InvalidSelectorError);
	assert.throws(() => extractItems($, BASE, { itemSelector: 'article', urlPattern: '(' }), InvalidPatternError);
});

test('suggestSelectors ranks the dated article cards first and skips broken extras', () => {
	const suggestions = suggestSelectors(parsePage(PAGE), BASE, ['article[', '.card']);
	assert.ok(suggestions.length > 0);
	assert.equal(suggestions[0].selector, 'article');
	assert.equal(suggestions[0].items, 3);
	assert.equal(suggestions[0].dated, 2);
	assert.equal(suggestions[0].sample, 'This niche Adobe InDesign issue should be a warning to all creatives');
	assert.ok(!suggestions.some((s) => s.selector === 'article['));
	// Too few items (2) → `.card` is not a listing candidate.
	assert.ok(!suggestions.some((s) => s.selector === '.card'));
	assert.ok(suggestions.length <= 6);
});

// --- Section mode ---
//
// Modelled on helpx.adobe.com's AEM markup: the release heading sits in its own grid column and
// the release body is in the FOLLOWING columns, not inside the heading's parent; a later heading
// is nested two levels deep inside one of those columns; every component carries an inline
// <style> block; and the page ends with a footer heading outside the region the releases live in.
const DOC_BASE = 'https://helpx.example.com/indesign/release-notes.html';

const DOC = `
<html><head><title>Release notes | InDesign</title></head><body>
<nav><a href="/indesign/">InDesign</a></nav>
<main class="grid">
	<div class="text aem-GridColumn"><div class="cmp-text"><h2>August 2026 (version 21.5.1)</h2></div></div>
	<div class="flex aem-GridColumn">
		<style>#root_content_flex_a{color:red}</style>
		<p class="body">This release includes bug fixes.</p>
	</div>

	<div class="text aem-GridColumn"><div class="cmp-text"><h2>July 2026 (version 21.5)</h2></div></div>
	<div class="surfaceSpecificContainer aem-GridColumn">
		<p>Intro to July.</p>
		<div class="accordion">
			<div class="panel"><img src="/content/dam/j.png" alt="Screenshot" data-track="x"><p>Detail.</p></div>
			<div class="text aem-GridColumn"><div class="cmp-text"><h2>Fixed issues</h2></div></div>
			<p>Bug list.</p>
		</div>
	</div>
	<div class="accordion aem-GridColumn"><p>Trailing accordion.</p></div>
</main>
<footer><h2>More like this</h2><p>Footer junk.</p></footer>
</body></html>`;

const SECTIONS = { itemSelector: '.cmp-text h2', mode: 'sections' } as const;

test('section mode makes one item per heading, with the heading as title and a slug for a URL', () => {
	const result = extractItems(parsePage(DOC), DOC_BASE, SECTIONS);
	assert.equal(result.matched, 3);
	assert.deepEqual(
		result.items.map((i) => i.title),
		['August 2026 (version 21.5.1)', 'July 2026 (version 21.5)', 'Fixed issues']
	);
	// The page offers no per-section link, so the URL is the page plus a slug of the heading —
	// content-derived, so a new release prepended later doesn't renumber the older items' guids.
	assert.equal(result.items[0].url, `${DOC_BASE}#august-2026-version-21-5-1`);
	assert.equal(result.items[2].url, `${DOC_BASE}#fixed-issues`);
});

test('a section is the following siblings, and stops at a heading nested deeper', () => {
	const [, july] = extractItems(parsePage(DOC), DOC_BASE, SECTIONS).items;
	assert.match(july.content ?? '', /Intro to July/);
	assert.match(july.content ?? '', /Detail/);
	// The next heading lives two levels down inside the same column: the walk descends to it and
	// stops there instead of swallowing it and everything after it.
	assert.doesNotMatch(july.content ?? '', /Fixed issues/);
	assert.doesNotMatch(july.content ?? '', /Bug list/);
});

test('the last section is bounded by the region the headings share, not by the page', () => {
	const last = extractItems(parsePage(DOC), DOC_BASE, SECTIONS).items[2];
	assert.match(last.content ?? '', /Bug list/);
	// Known limitation, and the reason this assertion is here: a trailing block INSIDE that region
	// with no heading of its own still belongs to the last section.
	assert.match(last.content ?? '', /Trailing accordion/);
	// The footer is outside it, so it never joins a release.
	assert.doesNotMatch(last.content ?? '', /Footer junk/);
});

test('section content drops inline CSS and CMS attributes and absolutizes images', () => {
	const items = extractItems(parsePage(DOC), DOC_BASE, SECTIONS).items;
	assert.doesNotMatch(items[0].content ?? '', /root_content_flex_a/);
	assert.equal(items[0].summary, 'This release includes bug fixes.');
	assert.match(items[1].content ?? '', /https:\/\/helpx\.example\.com\/content\/dam\/j\.png/);
	assert.doesNotMatch(items[1].content ?? '', /data-track/);
	assert.doesNotMatch(items[1].content ?? '', /class=/);
	// Block texts are separated, not run together.
	assert.equal(items[1].summary, 'Intro to July. Detail.');
});

test('a title pattern picks which sections become items, and every heading still ends one', () => {
	const result = extractItems(parsePage(DOC), DOC_BASE, { ...SECTIONS, titlePattern: '\\(version' });
	assert.deepEqual(
		result.items.map((i) => i.title),
		['August 2026 (version 21.5.1)', 'July 2026 (version 21.5)']
	);
	assert.equal(result.matched, 3); // the filtered heading is still counted as a match
	// "Fixed issues" is not an item any more, but it must still cut the July section short.
	assert.doesNotMatch(result.items[1].content ?? '', /Bug list/);
});

test('a month in the heading dates the section, in UTC', () => {
	const items = extractItems(parsePage(DOC), DOC_BASE, SECTIONS).items;
	// Built with Date.UTC on purpose: Date.parse reads a bare month-year in local time, which would
	// make the ISO day — and so the RSS bytes and the ETag — depend on the host's timezone.
	assert.equal(items[0].date, '2026-08-01T00:00:00.000Z');
	assert.equal(items[1].date, '2026-07-01T00:00:00.000Z');
	assert.equal(items[2].date, undefined); // "Fixed issues" carries no date
});

test('identical headings get distinct urls', () => {
	const doc = parsePage('<body><main><h2>Notes</h2><p>One.</p><h2>Notes</h2><p>Two.</p></main></body>');
	const items = extractItems(doc, DOC_BASE, { itemSelector: 'h2', mode: 'sections' }).items;
	assert.deepEqual(
		items.map((i) => i.url),
		[`${DOC_BASE}#notes`, `${DOC_BASE}#notes-2`]
	);
});

test('section suggestions are headings, ranked by the ones that carry a date', () => {
	const suggestions = suggestSelectors(parsePage(DOC), DOC_BASE, [], 'sections');
	assert.equal(suggestions[0].selector, 'main h2');
	assert.equal(suggestions[0].items, 3);
	assert.equal(suggestions[0].dated, 2);
	// Card candidates never appear in this mode.
	assert.ok(!suggestions.some((s) => s.selector === 'article'));
});

test('a title pattern also filters cards', () => {
	const items = extractItems(parsePage(PAGE), BASE, {
		itemSelector: 'article',
		titlePattern: 'InDesign'
	}).items;
	assert.ok(items.length > 0);
	assert.ok(items.every((i) => i.title.includes('InDesign')));
});
