// Page feeds: RSS that Miniflux Reader itself generates from an HTML listing page (a tag page, a
// "latest" section — anything with repeated item cards but no usable feed). Miniflux subscribes
// to a URL on our own origin; the server fetches the page, extracts the cards with a CSS selector
// and answers with RSS 2.0 (see src/lib/server/pageFeed/* and /api/page-feed/*).
//
// The feed URL *is* the config: every parameter rides in the query string, HMAC-signed by the
// server so the public endpoint can't be driven as an open proxy. Nothing is stored server-side
// and nothing goes to localStorage (settingsSync would sync it) — editing a page feed means
// re-signing the URL and writing the new feed_url to Miniflux.
//
// This is the pure, shared half: types, the query-key map, encode/decode/canonicalize and URL
// detection. No $lib, no browser or node imports, so the server modules and node --test load it.

// How the page is read. 'cards' (the default, and the only value ever written to the URL) means
// the selector matches repeated linked cards. 'sections' means it matches the headings of one long
// document — each item is a heading plus everything up to the next match, for pages like a
// release-notes page whose entries have no links of their own.
export type PageFeedMode = 'cards' | 'sections';

export interface PageFeedConfig {
	pageUrl: string;
	itemSelector: string; // the item cards, or in section mode the section headings
	mode?: PageFeedMode; // absent = 'cards'
	urlPattern?: string; // regex an absolute item URL must match (cards only — a section has no link)
	titlePattern?: string; // regex the title must match: drops 'Sponsored' cards, 'Fixed issues' sections
	limit?: number; // max items, page order
	titleSelector?: string; // overrides for the heuristics, all relative to the item
	dateSelector?: string;
	summarySelector?: string;
	imageSelector?: string;
}

export const PAGE_FEED_PATH = '/api/page-feed/rss';
export const PAGE_FEED_SIG_KEY = 'sig';
export const PAGE_FEED_LIMIT_DEFAULT = 50;
export const PAGE_FEED_LIMIT_MAX = 100;

// Short query keys — the URL is long enough with a selector and a page URL in it.
export const PAGE_FEED_KEYS = {
	pageUrl: 'u',
	itemSelector: 's',
	mode: 'm',
	urlPattern: 'p',
	titlePattern: 'r',
	limit: 'n',
	titleSelector: 't',
	dateSelector: 'd',
	summarySelector: 'x',
	imageSelector: 'i'
} as const;

type ConfigField = keyof typeof PAGE_FEED_KEYS;
type StringField = Exclude<ConfigField, 'limit' | 'mode'>;

const STRING_FIELDS: StringField[] = [
	'pageUrl',
	'itemSelector',
	'urlPattern',
	'titlePattern',
	'titleSelector',
	'dateSelector',
	'summarySelector',
	'imageSelector'
];

const KNOWN_KEYS = new Set<string>(Object.values(PAGE_FEED_KEYS));

export function isKnownPageFeedKey(key: string): boolean {
	return KNOWN_KEYS.has(key);
}

// Trimmed, empties dropped, limit as a decimal string. The result is what gets signed.
export function encodePageFeedParams(cfg: PageFeedConfig): Record<string, string> {
	const out: Record<string, string> = {};
	for (const field of STRING_FIELDS) {
		const value = (cfg[field] ?? '').trim();
		if (value) out[PAGE_FEED_KEYS[field]] = value;
	}
	if (cfg.limit != null && Number.isInteger(cfg.limit) && cfg.limit > 0) {
		out[PAGE_FEED_KEYS.limit] = String(cfg.limit);
	}
	// 'cards' is deliberately never written: every URL signed before this key existed canonicalizes
	// to the string it always did, so old feeds keep verifying and don't read as edited.
	if (cfg.mode === 'sections') out[PAGE_FEED_KEYS.mode] = 'sections';
	return out;
}

// null when the two required keys are missing or the limit isn't a small positive integer.
// Range/length checks live in the server validator; this is only the shape.
export function decodePageFeedParams(
	params: URLSearchParams | Record<string, string>
): PageFeedConfig | null {
	const get = (key: string): string | null =>
		params instanceof URLSearchParams ? params.get(key) : (params[key] ?? null);

	const pageUrl = get(PAGE_FEED_KEYS.pageUrl)?.trim();
	const itemSelector = get(PAGE_FEED_KEYS.itemSelector)?.trim();
	if (!pageUrl || !itemSelector) return null;

	const cfg: PageFeedConfig = { pageUrl, itemSelector };
	for (const field of STRING_FIELDS) {
		if (field === 'pageUrl' || field === 'itemSelector') continue;
		const value = get(PAGE_FEED_KEYS[field])?.trim();
		if (value) cfg[field] = value;
	}
	const n = get(PAGE_FEED_KEYS.limit);
	if (n != null && n !== '') {
		if (!/^\d{1,3}$/.test(n) || Number(n) < 1) return null;
		cfg.limit = Number(n);
	}
	// An unreadable mode is a malformed URL, not a reason to quietly fall back to cards — the feed
	// would then be extracted a different way than the one that was signed.
	const m = get(PAGE_FEED_KEYS.mode);
	if (m != null && m !== '') {
		if (m !== 'sections' && m !== 'cards') return null;
		if (m === 'sections') cfg.mode = 'sections';
	}
	return cfg;
}

// Known keys only, sorted, URLSearchParams encoding. Signer and verifier both go through here,
// so the order Miniflux (or a user) keeps the params in never matters.
export function canonicalPageFeedQuery(params: Record<string, string>): string {
	const sp = new URLSearchParams();
	for (const key of Object.keys(params).sort()) {
		if (!isKnownPageFeedKey(key)) continue;
		const value = params[key];
		if (value !== '') sp.set(key, value);
	}
	return sp.toString();
}

// A feed_url is ours if it hits the rss path and carries the signed shape. The origin is
// deliberately not checked: dev and prod sign for different origins.
export function isPageFeedUrl(url: string): boolean {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return false;
	}
	return (
		u.pathname === PAGE_FEED_PATH &&
		u.searchParams.has(PAGE_FEED_KEYS.pageUrl) &&
		u.searchParams.has(PAGE_FEED_KEYS.itemSelector) &&
		u.searchParams.has(PAGE_FEED_SIG_KEY)
	);
}

export function parsePageFeedUrl(url: string): PageFeedConfig | null {
	if (!isPageFeedUrl(url)) return null;
	return decodePageFeedParams(new URL(url).searchParams);
}

// Stable identity of a config for dirty-tracking: whitespace and empty optionals don't count.
export function pageFeedConfigKey(cfg: PageFeedConfig | null): string {
	return cfg ? canonicalPageFeedQuery(encodePageFeedParams(cfg)) : '';
}

// --- Wire types shared with /api/page-feed/preview -------------------------------------------

export interface PageFeedItem {
	url: string;
	title: string;
	content?: string; // section mode: the section's own HTML, which becomes the RSS description
	date?: string; // ISO 8601
	summary?: string;
	image?: string;
}

export interface PageFeedSuggestion {
	selector: string;
	items: number;
	dated: number; // how many of those items carry a date
	sample: string; // first item's title
}

export interface PageFeedPreview {
	pageTitle: string;
	suggestions: PageFeedSuggestion[];
	htmlSample: string; // cleaned, capped HTML for the AI selector prompt
	truncated: boolean;
	// Present when the request carried an itemSelector.
	items?: PageFeedItem[];
	matched?: number;
	feedUrl?: string; // signed, absolute — what Miniflux subscribes to
}

// A signed feed URL together with the config key it was minted for — Feed Settings uses it to
// know whether the URL on file still matches what the user is looking at.
export interface PageFeedSigned {
	key: string;
	feedUrl: string;
}
