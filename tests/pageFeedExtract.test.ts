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
