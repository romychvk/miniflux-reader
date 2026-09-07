import { createHmac, timingSafeEqual } from 'node:crypto';
import {
	PAGE_FEED_PATH,
	PAGE_FEED_SIG_KEY,
	canonicalPageFeedQuery,
	encodePageFeedParams,
	isKnownPageFeedKey,
	type PageFeedConfig
} from '../../pageFeed';

// HMAC over the canonical query. The public rss route is unauthenticated (Miniflux's crawler
// can't send our headers), so the signature is what stops it from being a fetch-anything proxy:
// only URLs minted by /api/page-feed/preview for a logged-in user verify.

export function signPageFeedParams(params: Record<string, string>, secret: string): string {
	return createHmac('sha256', secret).update(canonicalPageFeedQuery(params)).digest('base64url');
}

export function verifyPageFeedSignature(
	params: Record<string, string>,
	sig: string,
	secret: string
): boolean {
	if (!sig || !secret) return false;
	const expected = Buffer.from(signPageFeedParams(params, secret));
	const given = Buffer.from(sig);
	return expected.length === given.length && timingSafeEqual(expected, given);
}

export function buildSignedPageFeedPath(cfg: PageFeedConfig, secret: string): string {
	const params = encodePageFeedParams(cfg);
	const canonical = canonicalPageFeedQuery(params);
	return `${PAGE_FEED_PATH}?${canonical}&${PAGE_FEED_SIG_KEY}=${signPageFeedParams(params, secret)}`;
}

// Splits a request's query into the signed params and the signature. Strict on purpose: an
// unknown or repeated key is a malformed request (400), not something to silently drop —
// dropping would let `&u=` ride along twice with only the first one signed.
export function parseSignedQuery(
	sp: URLSearchParams
): { params: Record<string, string>; sig: string } | null {
	const params: Record<string, string> = {};
	const seen = new Set<string>();
	let sig: string | null = null;
	for (const [key, value] of sp) {
		if (seen.has(key)) return null;
		seen.add(key);
		if (key === PAGE_FEED_SIG_KEY) {
			sig = value;
			continue;
		}
		if (!isKnownPageFeedKey(key)) return null;
		params[key] = value;
	}
	if (!sig) return null;
	return { params, sig };
}
