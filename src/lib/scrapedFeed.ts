// "Feed from a page without RSS": pure logic behind ScrapedFeedWizard. The wizard previews
// CSS-selector matches client-side (over HTML fetched via /api/fetch-page, same DOMParser
// approach as cover.ts) and assembles a CssSelectorBridge URL on the user's RSS-Bridge
// instance; Miniflux then subscribes to that URL like any feed.

import type { RssBridgeConfig } from './rssbridge';

export interface PreviewItem {
	title: string;
	href: string;
}

export interface MatchResult {
	items: PreviewItem[]; // deduped by absolute href
	matched: number; // raw querySelectorAll count
	nonAnchor: boolean; // some matches were not <a href> themselves
}

export function parsePage(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html');
}

// A selector the user typed can be syntactically invalid — surface that distinctly from
// "valid but matches nothing".
export class InvalidSelectorError extends Error {
	constructor(selector: string) {
		super(`Invalid CSS selector: ${selector}`);
	}
}

function isAnchor(el: Element): el is HTMLAnchorElement {
	return el.tagName === 'A' && el.hasAttribute('href');
}

// The link an element stands for: itself if it's an anchor, else the first anchor inside,
// else the nearest enclosing one (title text wrapped in a link, or a card inside <a>).
function resolveAnchor(el: Element): HTMLAnchorElement | null {
	if (isAnchor(el)) return el;
	return el.querySelector<HTMLAnchorElement>('a[href]') ?? el.closest<HTMLAnchorElement>('a[href]');
}

function itemTitle(el: Element, anchor: Element): string {
	const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (text) return text;
	return anchor.getAttribute('title')?.trim() || anchor.getAttribute('aria-label')?.trim() || '';
}

export function matchItems(doc: Document, selector: string, baseUrl: string): MatchResult {
	let matches: NodeListOf<Element>;
	try {
		matches = doc.querySelectorAll(selector);
	} catch {
		throw new InvalidSelectorError(selector);
	}

	const seen = new Set<string>();
	const items: PreviewItem[] = [];
	let nonAnchor = false;

	for (const el of matches) {
		const anchor = resolveAnchor(el);
		if (!anchor) {
			nonAnchor = true;
			continue;
		}
		if (anchor !== el) nonAnchor = true;

		const raw = anchor.getAttribute('href') ?? '';
		if (!raw || raw.startsWith('#') || /^(javascript|mailto):/i.test(raw)) continue;
		let href: string;
		try {
			href = new URL(raw, baseUrl).toString();
		} catch {
			continue;
		}
		if (seen.has(href)) continue;
		seen.add(href);
		items.push({ title: itemTitle(el, anchor), href });
	}

	return { items, matched: matches.length, nonAnchor };
}

// CssSelectorBridge reads hrefs off the matched elements, so the selector we send should hit
// the <a> tags directly. When the user's selector matches containers, try `… a`: if it
// resolves to the same link set, send that instead; otherwise keep the original (the preview
// warning tells the user to narrow it by hand).
export function anchorizeSelector(doc: Document, selector: string, baseUrl: string): string {
	const original = matchItems(doc, selector, baseUrl);
	if (!original.nonAnchor || original.items.length === 0) return selector;

	const candidate = `${selector} a`;
	let widened: MatchResult;
	try {
		widened = matchItems(doc, candidate, baseUrl);
	} catch {
		return selector;
	}
	const a = original.items.map((i) => i.href);
	const b = widened.items.map((i) => i.href);
	if (a.length === b.length && a.every((href, i) => href === b[i])) return candidate;
	return selector;
}

export interface ScrapedFeedOptions {
	instance: string;
	pageUrl: string;
	urlSelector: string;
	urlPattern?: string;
	contentSelector?: string;
	titleCleanup?: string;
	limit?: number;
	discardThumbnail?: boolean;
}

export function buildScrapedFeedConfig(opts: ScrapedFeedOptions): RssBridgeConfig {
	const params = [{ key: 'url_selector', value: opts.urlSelector.trim() }];
	if (opts.urlPattern?.trim()) params.push({ key: 'url_pattern', value: opts.urlPattern.trim() });
	if (opts.contentSelector?.trim())
		params.push({ key: 'content_selector', value: opts.contentSelector.trim() });
	if (opts.titleCleanup?.trim())
		params.push({ key: 'title_cleanup', value: opts.titleCleanup.trim() });
	if (opts.limit && opts.limit > 0) params.push({ key: 'limit', value: String(opts.limit) });
	if (opts.discardThumbnail) params.push({ key: 'discard_thumbnail', value: 'on' });
	params.push({ key: 'format', value: 'Atom' });

	return {
		instance: opts.instance,
		bridge: 'CssSelectorBridge',
		sourceUrl: opts.pageUrl.trim(),
		sourceKey: 'home_page',
		params
	};
}

// Sanity-check a bridge response without parsing XML — /api/fetch-page caps at 80KB, which
// can cut the document mid-entry, and its clean() strips comments.
export function countBridgeEntries(text: string): { isFeed: boolean; entries: number } {
	const isFeed = /<(feed|rss)[\s>]/i.test(text);
	const entries = (text.match(/<(entry|item)[\s>]/gi) ?? []).length;
	return { isFeed, entries };
}
