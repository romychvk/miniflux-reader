import { safeFetch, type SafeFetchResult } from './safeFetch';

// One HTML fetch of an arbitrary source page, shared by /api/fetch-page, /api/og-image and the
// page-feed routes. They all reach for the same two things: a User-Agent the source site will
// serve, and a status to answer with when it won't.

// A real-looking UA avoids trivial bot blocks on the source site.
const USER_AGENT = 'Mozilla/5.0 (compatible; MinifluxReader/1.0; +https://miniflux.app)';
// Some WAFs invert that check: they 403 anything claiming to be a browser that fails their
// browser fingerprint, while waving through a client that honestly says it is a feed reader
// (quark.com does exactly this — even a full Chrome header set is refused). So a 403 is retried
// once with a plain, non-Mozilla UA; both shapes of bot blocking are common, and only the pair
// gets through both.
const FALLBACK_USER_AGENT = 'MinifluxReader/1.0 (+https://miniflux.app)';

const TIMEOUT_MS = 12_000; // Miniflux gives a feed 20 s in total — leave room to parse
const RETRY_MIN_MS = 3_000; // don't start the fallback attempt with less time than this left

// What these routes answer with when the source page can't be fetched or comes back non-2xx.
// Not 502: Cloudflare replaces an origin 502/504 with its own HTML error page, so the reason
// ("Source returned 403") would never reach the browser — 424 passes through untouched.
export const UPSTREAM_FAILED = 424;

export interface SourcePageOptions {
	maxBytes: number;
	timeoutMs?: number;
}

export async function fetchSourcePage(
	url: string,
	{ maxBytes, timeoutMs = TIMEOUT_MS }: SourcePageOptions
): Promise<SafeFetchResult> {
	const started = Date.now();
	const attempt = (userAgent: string, budgetMs: number) =>
		safeFetch(url, {
			headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' },
			maxBytes,
			timeoutMs: budgetMs
		});

	const first = await attempt(USER_AGENT, timeoutMs);
	if (first.status !== 403) return first;
	// Both attempts share one budget, so a slow 403 can't double the caller's wait.
	const left = timeoutMs - (Date.now() - started);
	if (left < RETRY_MIN_MS) return first;
	const retried = await attempt(FALLBACK_USER_AGENT, left);
	return retried.ok ? retried : first;
}
