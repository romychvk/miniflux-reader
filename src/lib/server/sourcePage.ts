import { SafeFetchError, safeFetch, type SafeFetchResult } from './safeFetch';

// One HTML fetch of an arbitrary source page, shared by /api/fetch-page, /api/og-image and the
// page-feed routes. They all reach for the same two things: a User-Agent the source site will
// serve, and a status to answer with when it won't.

// The UA ladder. Bot blocking comes in shapes that contradict each other, so one string cannot
// satisfy every WAF — each attempt below is here because a real site refuses the one above it.
//   1. A browser-shaped UA. What Cloudflare-style "you must look like a browser" blocking wants,
//      and the right default: most sites either don't care or prefer it.
//   2. Our own name plus a curl product token. quark.com 403s anything Mozilla-shaped that fails
//      its browser fingerprint (a full Chrome header set is refused too), and helpx.adobe.com's
//      Akamai goes further — it accepts a connection from an unrecognised client and then never
//      answers, so the block arrives as a timeout, not a status. Both serve a plain script client;
//      Akamai keys on the curl token specifically (a trailing "(+url)" comment loses it again).
const USER_AGENTS = [
	'Mozilla/5.0 (compatible; MinifluxReader/1.0; +https://miniflux.app)',
	'MinifluxReader/1.0 curl/8.5.0'
];

const TIMEOUT_MS = 14_000; // Miniflux gives a feed 20 s in total — leave room to parse
const FIRST_ATTEMPT_MS = 9_000; // cap the opening try so a tarpit still leaves budget for the next UA
const RETRY_MIN_MS = 3_000; // don't start another attempt with less time than this left

// Which UA last worked for a host, so the steady state — Miniflux polling a page feed every few
// minutes — pays the doomed first attempt once, not on every poll. Only a non-default winner is
// worth remembering; the crude clear-when-full eviction matches the page cache.
const UA_HOSTS_MAX = 200;
const uaByHost = new Map<string, string>();

function hostOf(url: string): string | null {
	try {
		return new URL(url).host;
	} catch {
		return null;
	}
}

// What these routes answer with when the source page can't be fetched or comes back non-2xx.
// Not 502: Cloudflare replaces an origin 502/504 with its own HTML error page, so the reason
// ("Source returned 403") would never reach the browser — 424 passes through untouched.
export const UPSTREAM_FAILED = 424;

export interface SourcePageOptions {
	maxBytes: number;
	timeoutMs?: number;
}

// A blocked request is not always a status: the ladder moves on for a 403 and for a connection
// that timed out or died, since that is how a silent block reads from here. A 404 or a 500 is the
// site's real answer and ends it, as does any refusal of ours (a private address, a bad scheme) —
// those are about the URL, and no User-Agent changes them.
export async function fetchSourcePage(
	url: string,
	{ maxBytes, timeoutMs = TIMEOUT_MS }: SourcePageOptions
): Promise<SafeFetchResult> {
	const attempt = (userAgent: string, budgetMs: number) =>
		safeFetch(url, {
			headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' },
			maxBytes,
			timeoutMs: budgetMs
		});

	const host = hostOf(url);
	const known = host ? uaByHost.get(host) : undefined;
	const ladder = known ? [known, ...USER_AGENTS.filter((ua) => ua !== known)] : USER_AGENTS;

	const started = Date.now();
	let firstResult: SafeFetchResult | undefined;
	let firstError: unknown;

	for (let i = 0; i < ladder.length; i++) {
		const remaining = timeoutMs - (Date.now() - started);
		if (i > 0 && remaining < RETRY_MIN_MS) break;
		const last = i === ladder.length - 1;
		// Every attempt shares one budget, so a tarpit can't multiply the caller's wait.
		const budget = last ? Math.max(remaining, RETRY_MIN_MS) : Math.min(remaining, FIRST_ATTEMPT_MS);

		try {
			const result = await attempt(ladder[i], budget);
			if (result.ok) {
				if (host && i > 0) {
					if (uaByHost.size >= UA_HOSTS_MAX) uaByHost.clear();
					uaByHost.set(host, ladder[i]);
				}
				return result;
			}
			firstResult ??= result;
			if (result.status !== 403) return result;
		} catch (e) {
			if (e instanceof SafeFetchError && e.isPolicy) throw e;
			firstError ??= e;
		}
	}

	// Nothing got through. The first answer is the site's own, so it is the one worth reporting.
	if (firstResult) return firstResult;
	throw firstError;
}
