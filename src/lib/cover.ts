// Per-feed cover/thumbnail extraction rule. Some sources expose the cover only in non-standard
// markup the generic heuristics (content <img>, enclosure, og:image) miss — e.g. rutracker keeps
// it in `<var class="postImg" title="URL">`, rendered to an <img> only by client JS. Rather than
// hardcoding such sites in shared code, each feed can carry its own CSS-selector rule (stored in
// localStorage; Miniflux has no field for it). Extraction runs client-side over the page HTML
// fetched via /api/fetch-page, so any CSS selector works through DOMParser.querySelector.

export interface CoverRule {
	selector: string; // CSS selector for the element holding the cover, e.g. "var.postImg"
	attr: string; // attribute holding the URL, e.g. "title". Empty = auto-detect.
}

export const COVER_STORAGE_PREFIX = 'cover:';

// Attributes tried (in order) when the rule's attr is empty — covers <img>, lazy-load variants,
// links, <meta content>, and rutracker's <var title>.
const ATTR_FALLBACKS = ['src', 'data-src', 'data-original', 'data-lazy-src', 'href', 'content', 'title'];

export function asCoverRule(raw: unknown): CoverRule {
	const r = (raw ?? {}) as Partial<CoverRule>;
	return { selector: typeof r.selector === 'string' ? r.selector : '', attr: typeof r.attr === 'string' ? r.attr : '' };
}

export function hasCoverRule(rule: CoverRule | null | undefined): boolean {
	return !!rule && rule.selector.trim() !== '';
}

// Resolve a cover URL from page HTML using the rule. Returns null if nothing matches.
export function extractCover(html: string, rule: CoverRule, baseUrl: string): string | null {
	const selector = rule.selector.trim();
	if (!selector) return null;

	let el: Element | null;
	try {
		el = new DOMParser().parseFromString(html, 'text/html').querySelector(selector);
	} catch {
		return null; // invalid selector
	}
	if (!el) return null;

	const attrs = rule.attr.trim() ? [rule.attr.trim(), ...ATTR_FALLBACKS] : ATTR_FALLBACKS;
	for (const a of attrs) {
		const v = el.getAttribute(a);
		if (v) {
			try {
				return new URL(v, baseUrl).toString();
			} catch {
				return v;
			}
		}
	}
	return null;
}
