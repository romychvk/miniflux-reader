import { load, type Cheerio, type CheerioAPI } from 'cheerio';
// cheerio doesn't re-export its node types; domhandler is a devDependency for exactly this.
import type { AnyNode } from 'domhandler';
import {
	PAGE_FEED_LIMIT_DEFAULT,
	PAGE_FEED_LIMIT_MAX,
	type PageFeedConfig,
	type PageFeedItem,
	type PageFeedSuggestion
} from '../../pageFeed';

// Turns a listing page into feed items. The user (or the suggester below) names the repeated
// per-item element with a CSS selector; everything else — link, title, date, summary, image —
// is found by heuristics relative to that element, each of which can be pinned with an explicit
// selector when a site defeats them.
//
// cheerio's default parser is parse5, so the tree matches what a browser would build — the same
// selector behaves the same in DevTools, in the wizard preview and in the feed Miniflux fetches.
// Pure module: no $env/$lib, so node --test can load it directly.

// The wire shape the wizard shows and the rss builder renders — defined once, in pageFeed.ts.
export type ExtractedItem = PageFeedItem;
export type SelectorCandidate = PageFeedSuggestion;

export interface ExtractResult {
	items: ExtractedItem[];
	matched: number; // raw selector hit count, before link/title filtering
	pageTitle: string;
}

export type ExtractConfig = Omit<PageFeedConfig, 'pageUrl'>;
export type PageDoc = CheerioAPI;

export class InvalidSelectorError extends Error {
	constructor(selector: string) {
		super(`Invalid CSS selector: ${selector}`);
		this.name = 'InvalidSelectorError';
	}
}

export class InvalidPatternError extends Error {
	constructor(pattern: string) {
		super(`Invalid link pattern: ${pattern}`);
		this.name = 'InvalidPatternError';
	}
}

const TITLE_MAX = 200;
const SUMMARY_MAX = 500;
const PAGE_TITLE_MAX = 200;
const HEADINGS = 'h1, h2, h3, h4';
// Elements that stand for one listed item when the selector hit something smaller (a title link).
const ITEM_CONTAINERS = 'article, li';
// Paragraph classes that are metadata, not a standfirst.
const SUMMARY_SKIP = /byline|author|meta|date|time|tag|categor|label|kicker/i;
const SUMMARY_PREFER =
	'[class*=synopsis], [class*=summary], [class*=excerpt], [class*=standfirst], [class*=teaser], [class*=intro], [class*=dek], [class*=description]';
// Template placeholders (`SPONSORED_HEADLINE`) that some CMSes leave in the markup.
const PLACEHOLDER_TITLE = /^[A-Z0-9_]{6,}$/;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number): string =>
	text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;

// Parse once, query many times: the wizard scores a dozen selectors against a page that can be
// a megabyte or more.
export function parsePage(html: string): PageDoc {
	return load(html);
}

export function pageTitle($: PageDoc): string {
	return clip(collapse($('title').first().text()), PAGE_TITLE_MAX);
}

function select($: PageDoc, selector: string, context?: Cheerio<AnyNode>): Cheerio<AnyNode> {
	try {
		return context ? context.find(selector) : $(selector);
	} catch {
		throw new InvalidSelectorError(selector);
	}
}

// The link an element stands for: itself if it's an anchor, else the first anchor inside, else
// the nearest enclosing one (a title wrapped in a link, or a whole card wrapped in <a>).
function resolveAnchor(el: Cheerio<AnyNode>): Cheerio<AnyNode> | null {
	if (el.is('a[href]')) return el;
	const inner = el.find('a[href]').first();
	if (inner.length) return inner;
	const outer = el.closest('a[href]');
	return outer.length ? outer : null;
}

function resolveHref(raw: string | undefined, baseUrl: string): string | null {
	const href = (raw ?? '').trim();
	if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return null;
	let url: URL;
	try {
		url = new URL(href, baseUrl);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	url.hash = '';
	return url.toString();
}

// Where to look for the date/summary/image: the matched element when it is the card itself,
// otherwise the card around it.
function itemScope(el: Cheerio<AnyNode>): Cheerio<AnyNode> {
	if (el.find(`${HEADINGS}, time, p`).length) return el;
	const container = el.closest(ITEM_CONTAINERS);
	if (container.length) return container;
	const parent = el.parent();
	return parent.length ? parent : el;
}

function itemTitle(
	$: PageDoc,
	el: Cheerio<AnyNode>,
	scope: Cheerio<AnyNode>,
	anchor: Cheerio<AnyNode>,
	url: string,
	cfg: ExtractConfig
): string {
	if (cfg.titleSelector) {
		const text = collapse(select($, cfg.titleSelector, scope).first().text());
		return text ? clip(text, TITLE_MAX) : '';
	}
	const heading = el.find(HEADINGS).first();
	if (heading.length) {
		const text = collapse(heading.text());
		if (text) return clip(text, TITLE_MAX);
	}
	const own = collapse(el.text());
	if (own) return clip(own, TITLE_MAX);
	// A text-less match (a thumbnail link) — the card around it names the item.
	const cardHeading = collapse(scope.find(HEADINGS).first().text());
	if (cardHeading) return clip(cardHeading, TITLE_MAX);
	const attr = collapse(anchor.attr('title') ?? anchor.attr('aria-label') ?? '');
	if (attr) return clip(attr, TITLE_MAX);
	// e.g. aria-label="Search result: <title>" on the card
	const labelled = scope.closest('[aria-label]').attr('aria-label') ?? '';
	const label = collapse(labelled.replace(/^[^:]{1,30}:\s*/, ''));
	if (label) return clip(label, TITLE_MAX);
	const segment = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
	return collapse(decodeURIComponent(segment).replace(/[-_]+/g, ' '));
}

function itemDate($: PageDoc, scope: Cheerio<AnyNode>, cfg: ExtractConfig): string | undefined {
	let node = cfg.dateSelector
		? select($, cfg.dateSelector, scope).first()
		: scope.find('time[datetime]').first();
	if (!node.length && !cfg.dateSelector) node = scope.find('time').first();
	if (!node.length) return undefined;
	const raw = collapse(node.attr('datetime') ?? node.attr('content') ?? node.text());
	const ms = Date.parse(raw);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function itemSummary(
	$: PageDoc,
	scope: Cheerio<AnyNode>,
	cfg: ExtractConfig,
	title: string
): string | undefined {
	if (cfg.summarySelector) {
		const text = collapse(select($, cfg.summarySelector, scope).first().text());
		return text ? clip(text, SUMMARY_MAX) : undefined;
	}
	const preferred = collapse(scope.find(SUMMARY_PREFER).first().text());
	if (preferred && preferred !== title) return clip(preferred, SUMMARY_MAX);

	let best = '';
	scope.find('p').each((_, p) => {
		const $p = $(p);
		if ($p.find('time').length) return;
		if (SUMMARY_SKIP.test($p.attr('class') ?? '')) return;
		const text = collapse($p.text());
		if (!text || text === title) return;
		if (text.length > best.length) best = text;
	});
	return best ? clip(best, SUMMARY_MAX) : undefined;
}

function firstSrcsetUrl(srcset: string | undefined): string | undefined {
	const first = (srcset ?? '').split(',')[0]?.trim().split(/\s+/)[0];
	return first || undefined;
}

function itemImage(
	$: PageDoc,
	scope: Cheerio<AnyNode>,
	cfg: ExtractConfig,
	baseUrl: string
): string | undefined {
	let img = cfg.imageSelector ? select($, cfg.imageSelector, scope).first() : scope.find('img').first();
	if (img.length && !img.is('img')) img = img.find('img').first();
	if (!img.length) return undefined;
	const candidates = [
		img.attr('src'),
		img.attr('data-src'),
		img.attr('data-original'),
		img.attr('data-lazy-src'),
		firstSrcsetUrl(img.attr('srcset') ?? img.attr('data-srcset'))
	];
	for (const candidate of candidates) {
		const value = (candidate ?? '').trim();
		if (!value || value.startsWith('data:')) continue;
		try {
			const url = new URL(value, baseUrl);
			if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
		} catch {
			// try the next attribute
		}
	}
	return undefined;
}

function compilePattern(pattern: string | undefined): RegExp | null {
	if (!pattern) return null;
	try {
		return new RegExp(pattern);
	} catch {
		throw new InvalidPatternError(pattern);
	}
}

function clampLimit(limit: number | undefined): number {
	if (limit == null || !Number.isInteger(limit) || limit < 1) return PAGE_FEED_LIMIT_DEFAULT;
	return Math.min(limit, PAGE_FEED_LIMIT_MAX);
}

export function extractItems($: PageDoc, baseUrl: string, cfg: ExtractConfig): ExtractResult {
	const selector = cfg.itemSelector.trim();
	if (!selector) throw new InvalidSelectorError(selector);
	const matches = select($, selector);
	const pattern = compilePattern(cfg.urlPattern);
	const limit = clampLimit(cfg.limit);

	const seen = new Set<string>();
	const items: ExtractedItem[] = [];
	for (const node of matches.toArray()) {
		if (items.length >= limit) break;
		const el = $(node);
		// A match that contains other matches is a wrapper, not an item (a page-level <article>
		// around the listing would otherwise claim the first card's link and its own h1).
		if (el.find(selector).length) continue;
		const anchor = resolveAnchor(el);
		if (!anchor) continue;
		const url = resolveHref(anchor.attr('href'), baseUrl);
		if (!url || seen.has(url)) continue;
		if (pattern && !pattern.test(url)) continue;

		const scope = itemScope(el);
		const title = itemTitle($, el, scope, anchor, url, cfg);
		if (!title || PLACEHOLDER_TITLE.test(title)) continue;
		seen.add(url);

		const item: ExtractedItem = { url, title };
		const date = itemDate($, scope, cfg);
		if (date) item.date = date;
		const summary = itemSummary($, scope, cfg, title);
		if (summary) item.summary = summary;
		const image = itemImage($, scope, cfg, baseUrl);
		if (image) item.image = image;
		items.push(item);
	}
	return { items, matched: matches.length, pageTitle: pageTitle($) };
}

// --- Selector suggestions ---------------------------------------------------------------------

// Semantic-first, most specific first: a site with <article> cards should get `article`, not
// `main a`. Ordered so index doubles as the final tie-breaker.
const DEFAULT_CANDIDATES = [
	'article',
	'article h2',
	'article h3',
	'article h2 a',
	'article h3 a',
	'li article',
	'main li',
	'.post',
	'.card',
	'.item',
	'[class*=card] a',
	'[class*=post] a',
	'[class*=article] a',
	'h2 a',
	'h3 a',
	'li a',
	'main a'
];

const MIN_ITEMS = 3;
const MAX_ITEMS = 100;
const SWEET_LOW = 8;
const SWEET_HIGH = 60;
const MAX_SUGGESTIONS = 6;

// Scores each candidate (built-ins plus any `extra`, e.g. from the AI) and returns the ones that
// look like a listing: 3–100 titled items, ranked by the share of items carrying a date (a
// selector that also sweeps up nav links dilutes it), whether the count sits in a typical
// listing band, then by list order — extras first, then semantic before generic. Deterministic.
export function suggestSelectors($: PageDoc, baseUrl: string, extra: string[] = []): SelectorCandidate[] {
	const selectors = [...extra, ...DEFAULT_CANDIDATES.filter((s) => !extra.includes(s))];
	const scored: { candidate: SelectorCandidate; index: number }[] = [];
	selectors.forEach((selector, index) => {
		let result: ExtractResult;
		try {
			result = extractItems($, baseUrl, { itemSelector: selector, limit: PAGE_FEED_LIMIT_MAX });
		} catch {
			return; // an AI candidate can be syntactically invalid
		}
		const count = result.items.length;
		if (count < MIN_ITEMS || count > MAX_ITEMS) return;
		scored.push({
			index,
			candidate: {
				selector,
				items: count,
				dated: result.items.filter((i) => i.date).length,
				sample: result.items[0].title
			}
		});
	});
	const inBand = (n: number) => (n >= SWEET_LOW && n <= SWEET_HIGH ? 1 : 0);
	const datedShare = (c: SelectorCandidate) => c.dated / c.items;
	scored.sort(
		(a, b) =>
			datedShare(b.candidate) - datedShare(a.candidate) ||
			inBand(b.candidate.items) - inBand(a.candidate.items) ||
			a.index - b.index
	);
	return scored.slice(0, MAX_SUGGESTIONS).map((s) => s.candidate);
}
