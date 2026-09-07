import { PAGE_FEED_LIMIT_MAX, type PageFeedConfig } from '../../pageFeed';

// Shape and size limits for a page-feed config, shared by the preview route (JSON body from the
// wizard) and the rss route (decoded from a signed query). Selectors and patterns are bounded
// because they end up in a URL and, for the pattern, in a RegExp run against every item href.

export const MAX_PAGE_URL = 2000;
export const MAX_SELECTOR = 300;
export const MAX_PATTERN = 200;
export const MAX_CANDIDATES = 8;

const SELECTOR_FIELDS = [
	'itemSelector',
	'titleSelector',
	'dateSelector',
	'summarySelector',
	'imageSelector'
] as const;

// Returns a human-readable problem, or null when the config is acceptable. `requireSelector`
// is false for the wizard's first call, which only wants the page loaded and selectors suggested.
export function validatePageFeedConfig(cfg: PageFeedConfig, requireSelector = true): string | null {
	let page: URL;
	try {
		page = new URL(cfg.pageUrl);
	} catch {
		return 'Invalid page URL';
	}
	if (page.protocol !== 'http:' && page.protocol !== 'https:') return 'Only http(s) URLs are allowed';
	if (cfg.pageUrl.length > MAX_PAGE_URL) return 'Page URL is too long';

	if (requireSelector && !cfg.itemSelector.trim()) return 'Item selector is required';
	for (const field of SELECTOR_FIELDS) {
		const value = cfg[field];
		if (value != null && value.length > MAX_SELECTOR) return `${field} is too long`;
	}

	if (cfg.urlPattern != null) {
		if (cfg.urlPattern.length > MAX_PATTERN) return 'Link pattern is too long';
		try {
			new RegExp(cfg.urlPattern);
		} catch {
			return 'Link pattern is not a valid regular expression';
		}
	}

	if (cfg.limit != null) {
		if (!Number.isInteger(cfg.limit) || cfg.limit < 1 || cfg.limit > PAGE_FEED_LIMIT_MAX)
			return `Max items must be between 1 and ${PAGE_FEED_LIMIT_MAX}`;
	}
	return null;
}

function optionalString(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const value = raw.trim();
	return value ? value : undefined;
}

export interface PreviewRequest {
	config: PageFeedConfig;
	candidates: string[];
}

// The wizard's JSON body → a config (itemSelector may be empty) plus AI-suggested candidate
// selectors to score. Returns an error string for anything malformed.
export function parsePreviewRequest(raw: unknown): PreviewRequest | { error: string } {
	if (!raw || typeof raw !== 'object') return { error: 'Invalid request body' };
	const body = raw as Record<string, unknown>;
	if (typeof body.pageUrl !== 'string' || !body.pageUrl.trim()) return { error: 'Missing pageUrl' };

	const config: PageFeedConfig = {
		pageUrl: body.pageUrl.trim(),
		itemSelector: optionalString(body.itemSelector) ?? ''
	};
	const urlPattern = optionalString(body.urlPattern);
	if (urlPattern) config.urlPattern = urlPattern;
	for (const field of ['titleSelector', 'dateSelector', 'summarySelector', 'imageSelector'] as const) {
		const value = optionalString(body[field]);
		if (value) config[field] = value;
	}
	if (body.limit != null && body.limit !== '') {
		const limit = typeof body.limit === 'string' ? Number(body.limit) : body.limit;
		if (typeof limit !== 'number' || !Number.isInteger(limit))
			return { error: 'Max items must be a whole number' };
		config.limit = limit;
	}

	const problem = validatePageFeedConfig(config, false);
	if (problem) return { error: problem };

	let candidates: string[] = [];
	if (Array.isArray(body.candidates)) {
		candidates = body.candidates
			.filter((c): c is string => typeof c === 'string')
			.map((c) => c.trim())
			.filter((c) => c && c.length <= MAX_SELECTOR)
			.slice(0, MAX_CANDIDATES);
	}
	return { config, candidates };
}
