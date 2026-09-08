import { load, type Cheerio, type CheerioAPI } from 'cheerio';
// cheerio doesn't re-export its node types; domhandler is a devDependency for exactly this.
import type { AnyNode } from 'domhandler';
import {
	PAGE_FEED_LIMIT_DEFAULT,
	PAGE_FEED_LIMIT_MAX,
	type PageFeedConfig,
	type PageFeedItem,
	type PageFeedMode,
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
	constructor(pattern: string, label = 'link') {
		super(`Invalid ${label} pattern: ${pattern}`);
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

// --- Section mode knobs ---
const SECTION_HTML_MAX = 50_000; // a runaway section shouldn't put a megabyte into one RSS item
const SLUG_MAX = 60;
const UNWRAP_PASSES = 8;
// Dropped outright: presentation, behaviour and anything that would run in the reader.
const CONTENT_DROP = 'style, script, noscript, template, link, iframe, svg, form, button, input';
// A CMS hangs class/style/data-* on every wrapper; on one AEM release that was two thirds of the
// bytes. Keep only what a reader renders from.
const KEEP_ATTRS = new Set(['href', 'src', 'srcset', 'alt', 'title', 'datetime', 'colspan', 'rowspan']);
const WRAPPERS = 'div, span, section, aside';
const MEDIA = 'img, video, audio, picture';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const TEXT_DATE =
	/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(\d{4})\b/i;

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

function compilePattern(pattern: string | undefined, label?: string): RegExp | null {
	if (!pattern) return null;
	try {
		return new RegExp(pattern);
	} catch {
		throw new InvalidPatternError(pattern, label);
	}
}

function clampLimit(limit: number | undefined): number {
	if (limit == null || !Number.isInteger(limit) || limit < 1) return PAGE_FEED_LIMIT_DEFAULT;
	return Math.min(limit, PAGE_FEED_LIMIT_MAX);
}

// Cards or sections — the routes call this and never care which. See extractSections below for
// the second mode.
export function extractItems($: PageDoc, baseUrl: string, cfg: ExtractConfig): ExtractResult {
	return cfg.mode === 'sections' ? extractSections($, baseUrl, cfg) : extractCards($, baseUrl, cfg);
}

function extractCards($: PageDoc, baseUrl: string, cfg: ExtractConfig): ExtractResult {
	const selector = cfg.itemSelector.trim();
	if (!selector) throw new InvalidSelectorError(selector);
	const matches = select($, selector);
	const pattern = compilePattern(cfg.urlPattern);
	const titlePattern = compilePattern(cfg.titlePattern, 'title');
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
		if (titlePattern && !titlePattern.test(title)) continue;
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

// --- Section mode -----------------------------------------------------------------------------
//
// For a page that is one long document rather than a list of cards: a release-notes page whose
// entries are `<h2>August 2026 (version 21.5.1)</h2>` followed by prose, with no link, id or
// container of their own. The selector names the section headings; an item is a heading plus
// everything after it, in document order, up to the next match — which is not the same as the
// heading's subtree, because a CMS commonly puts the body in the heading's *following siblings*
// (Adobe's AEM grid does exactly that).

const parentOf = (node: AnyNode): AnyNode | null => (node.parent as AnyNode | null) ?? null;
const nextOf = (node: AnyNode): AnyNode | null => (node.next as AnyNode | null) ?? null;
const childrenOf = (node: AnyNode): AnyNode[] =>
	'children' in node ? ((node.children as AnyNode[]) ?? []) : [];

function ancestorsOf(node: AnyNode): AnyNode[] {
	const chain: AnyNode[] = [];
	for (let p = parentOf(node); p; p = parentOf(p)) chain.push(p);
	return chain; // nearest first
}

// Where the sections live: the deepest element containing every heading. It is what stops the
// LAST section — which has no heading after it — from running on into the footer.
function sectionRoot($: PageDoc, boundaries: AnyNode[]): AnyNode | null {
	const body = $('body').get(0) ?? null;
	if (boundaries.length < 2) return body;
	let chain = ancestorsOf(boundaries[0]);
	for (const node of boundaries.slice(1)) {
		const set = new Set(ancestorsOf(node));
		chain = chain.filter((a) => set.has(a));
		if (!chain.length) return body;
	}
	return chain[0] ?? body;
}

// The children of each step on the path down to `stop` that come before it. Used when the next
// heading is nested inside a later sibling: we take the part of that subtree above the heading
// and nothing beyond it. The wrapper elements on the path are dropped rather than opened — the
// result is an HTML fragment, so a missing layout div costs nothing.
function descendPrefix(container: AnyNode, stop: AnyNode, out: AnyNode[]): void {
	const path: AnyNode[] = [stop];
	for (let p = parentOf(stop); p && p !== container; p = parentOf(p)) path.push(p);
	path.push(container);
	path.reverse(); // container … stop
	for (let i = 0; i < path.length - 1; i++) {
		for (const child of childrenOf(path[i])) {
			if (child === path[i + 1]) break;
			out.push(child);
		}
	}
}

// Everything strictly between two headings in document order: climb from the heading, sweeping
// following siblings at each level, until the next heading is reached or the root runs out.
function nodesBetween(start: AnyNode, stop: AnyNode | null, root: AnyNode | null): AnyNode[] {
	const stopAncestors = new Set(stop ? ancestorsOf(stop) : []);
	const out: AnyNode[] = [];
	for (let node: AnyNode | null = start; node && node !== root; node = parentOf(node)) {
		for (let sib = nextOf(node); sib; sib = nextOf(sib)) {
			if (sib === stop) return out;
			if (stopAncestors.has(sib)) {
				descendPrefix(sib, stop as AnyNode, out);
				return out;
			}
			out.push(sib);
		}
	}
	return out;
}

function absolutize($el: Cheerio<AnyNode>, attr: string, baseUrl: string): void {
	const raw = ($el.attr(attr) ?? '').trim();
	if (!raw || raw.startsWith('data:')) return;
	try {
		$el.attr(attr, new URL(raw, baseUrl).toString());
	} catch {
		$el.removeAttr(attr); // a relative URL we can't resolve is dead weight in a reader
	}
}

// The section's own markup, cloned out of the shared parse (suggestSelectors scores many
// selectors against one document — mutating it would make the result order-dependent), stripped
// of everything a reader doesn't render and of the CMS wrapper soup.
function sectionContent($: PageDoc, nodes: AnyNode[], baseUrl: string): Cheerio<AnyNode> {
	const frag = $('<div></div>');
	for (const node of nodes) frag.append($(node).clone());
	frag.find(CONTENT_DROP).remove();

	frag.find('*').each((_, node) => {
		const $el = $(node);
		if ('attribs' in node) {
			for (const name of Object.keys(node.attribs ?? {})) {
				if (!KEEP_ATTRS.has(name)) $el.removeAttr(name);
			}
		}
		for (const attr of ['href', 'src', 'srcset']) {
			if ($el.attr(attr) != null) absolutize($el, attr, baseUrl);
		}
	});

	for (let pass = 0; pass < UNWRAP_PASSES; pass++) {
		let changed = 0;
		frag.find(WRAPPERS).each((_, node) => {
			const $el = $(node);
			if (!$el.text().trim() && !$el.find(MEDIA).length) {
				$el.remove();
				changed++;
				return;
			}
			const kids = $el.children();
			const ownText = $el
				.contents()
				.filter((_i, child) => child.type === 'text' && ('data' in child ? child.data.trim() !== '' : false));
			if (!ownText.length && kids.length === 1) {
				$el.replaceWith(kids);
				changed++;
			}
		});
		if (!changed) break;
	}
	return frag;
}

// cheerio's .text() runs block texts together ("Intro to July.Detail."). Same block-spacing trick
// the research store uses in the browser, applied to a throwaway clone so the content fragment
// itself keeps the exact bytes that go into the feed.
function fragmentText($: PageDoc, frag: Cheerio<AnyNode>): string {
	const copy = $('<div></div>').append(frag.clone().contents());
	copy.find('br, p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote').before(' ');
	return collapse(copy.text());
}

// Trim from the end until the markup fits. Dropping whole top-level nodes keeps the fragment
// well-formed; when one node is itself over the cap it is opened up and the trimming continues
// inside it.
function cappedHtml(frag: Cheerio<AnyNode>): string {
	let html = frag.html() ?? '';
	for (let guard = 0; guard < 64 && html.length > SECTION_HTML_MAX; guard++) {
		const children = frag.children();
		if (children.length > 1) children.last().remove();
		else if (children.length === 1 && children.children().length) {
			children.first().replaceWith(children.first().children());
		} else break;
		html = frag.html() ?? '';
	}
	return html.length > SECTION_HTML_MAX ? html.slice(0, 0) : html.trim();
}

// A heading like "August 2026 (version 21.5.1)" is the section's date. Parsed explicitly and
// built in UTC: Date.parse reads a bare month-year in LOCAL time, which would make the ISO day —
// and therefore the RSS bytes and the ETag — depend on the host's timezone.
function headingDate(text: string): string | undefined {
	const iso = ISO_DATE.exec(text);
	if (iso) return utcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
	const m = TEXT_DATE.exec(text);
	if (!m) return undefined;
	return utcDate(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), m[2] ? Number(m[2]) : 1);
}

function utcDate(year: number, month: number, day: number): string | undefined {
	if (month < 0 || month > 11 || day < 1 || day > 31) return undefined;
	const ms = Date.UTC(year, month, day);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

// The page gives a section no URL, so one is derived from its heading. Content-derived on
// purpose: a new release prepended to the page must not renumber every older item's guid and
// resurrect the whole feed as unread.
function sectionSlug(title: string): string {
	const base = title
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '') // combining marks the decomposition left behind
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, SLUG_MAX)
		.replace(/-+$/g, '');
	return base || encodeURIComponent(collapse(title)).slice(0, SLUG_MAX);
}

function extractSections($: PageDoc, baseUrl: string, cfg: ExtractConfig): ExtractResult {
	const selector = cfg.itemSelector.trim();
	if (!selector) throw new InvalidSelectorError(selector);
	const matches = select($, selector);
	const titlePattern = compilePattern(cfg.titlePattern, 'title');
	const limit = clampLimit(cfg.limit);

	// EVERY match ends the previous section, but only those passing the title pattern become
	// items — that is what lets a "Fixed issues" heading cut a release short without becoming an
	// entry of its own.
	const boundaries = matches.toArray().filter((node) => !$(node).find(selector).length);
	const root = sectionRoot($, boundaries);
	const used = new Map<string, number>();
	const items: ExtractedItem[] = [];

	for (let i = 0; i < boundaries.length; i++) {
		if (items.length >= limit) break;
		const heading = $(boundaries[i]);
		const title = clip(collapse(heading.text()), TITLE_MAX);
		if (!title || PLACEHOLDER_TITLE.test(title)) continue;
		if (titlePattern && !titlePattern.test(title)) continue;

		const slug = sectionSlug(title);
		const seen = (used.get(slug) ?? 0) + 1;
		used.set(slug, seen);
		const url = new URL(baseUrl);
		url.hash = seen === 1 ? slug : `${slug}-${seen}`;

		const frag = sectionContent($, nodesBetween(boundaries[i], boundaries[i + 1] ?? null, root), baseUrl);
		const item: ExtractedItem = { url: url.toString(), title };
		const content = cappedHtml(frag);
		if (content) item.content = content;
		const summary = cfg.summarySelector
			? collapse(select($, cfg.summarySelector, frag).first().text())
			: fragmentText($, frag);
		if (summary) item.summary = clip(summary, SUMMARY_MAX);
		const date = itemDate($, frag, cfg) ?? headingDate(title);
		if (date) item.date = date;
		const image = itemImage($, frag, cfg, baseUrl);
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

// Section mode is looking for the repeated heading of a document, so the candidates are headings
// and the semantic containers they usually sit in.
const SECTION_CANDIDATES = ['main h2', 'article h2', '.content h2', 'h2', 'main h3', 'h3', 'h2, h3'];

const MIN_ITEMS = 3;
// A release-notes page with two releases on it is a normal page, not a failed match.
const MIN_SECTIONS = 2;
const MAX_ITEMS = 100;
const SWEET_LOW = 8;
const SWEET_HIGH = 60;
const MAX_SUGGESTIONS = 6;

// Scores each candidate (built-ins plus any `extra`, e.g. from the AI) and returns the ones that
// look like a listing: 3–100 titled items, ranked by the share of items carrying a date (a
// selector that also sweeps up nav links dilutes it), whether the count sits in a typical
// listing band, then by list order — extras first, then semantic before generic. Deterministic.
export function suggestSelectors(
	$: PageDoc,
	baseUrl: string,
	extra: string[] = [],
	mode: PageFeedMode = 'cards'
): SelectorCandidate[] {
	const defaults = mode === 'sections' ? SECTION_CANDIDATES : DEFAULT_CANDIDATES;
	const selectors = [...extra, ...defaults.filter((s) => !extra.includes(s))];
	const minItems = mode === 'sections' ? MIN_SECTIONS : MIN_ITEMS;
	const scored: { candidate: SelectorCandidate; index: number }[] = [];
	selectors.forEach((selector, index) => {
		let result: ExtractResult;
		try {
			result = extractItems($, baseUrl, { itemSelector: selector, mode, limit: PAGE_FEED_LIMIT_MAX });
		} catch {
			return; // an AI candidate can be syntactically invalid
		}
		const count = result.items.length;
		if (count < minItems || count > MAX_ITEMS) return;
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
