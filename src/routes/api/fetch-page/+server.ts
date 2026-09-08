import type { RequestHandler } from './$types';
import { requireMinifluxAuth } from '$lib/server/minifluxAuth';
import { SafeFetchError, describeSafeFetchError } from '$lib/server/safeFetch';
import { UPSTREAM_FAILED, fetchSourcePage } from '$lib/server/sourcePage';
import { clean } from '$lib/server/htmlClean';

// Fetches the raw HTML of an article page server-side so the rule assistant can
// see the original DOM structure (needed to propose scraper_rules for the
// "expand" case). Browser fetch can't do this cross-origin, hence the proxy.
//
// This fetches an arbitrary user-supplied URL, so it's gated two ways: requireMinifluxAuth (no
// anonymous use) and safeFetch (rejects private/loopback targets, validates every redirect hop,
// times out, and streams with a byte cap).

const MAX_BYTES = 80_000;

export const GET: RequestHandler = async ({ request, url }) => {
	const auth = await requireMinifluxAuth(request);
	if (auth instanceof Response) return auth;

	const target = url.searchParams.get('url');
	if (!target) {
		return new Response(JSON.stringify({ error: 'Missing url' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid url' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return new Response(JSON.stringify({ error: 'Only http(s) urls are allowed' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		// DoS guard on the raw read; clean()+slice below apply the real 80KB semantic cap.
		const result = await fetchSourcePage(parsed.toString(), { maxBytes: 3_000_000 });
		if (!result.ok) {
			return new Response(JSON.stringify({ error: `Source returned ${result.status}` }), {
				status: UPSTREAM_FAILED,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		const html = clean(result.body).slice(0, MAX_BYTES);
		return new Response(JSON.stringify({ html }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		if (e instanceof SafeFetchError) {
			return new Response(JSON.stringify({ error: describeSafeFetchError(e) }), {
				status: e.isPolicy ? 400 : UPSTREAM_FAILED,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		return new Response(JSON.stringify({ error: 'Failed to fetch page' }), {
			status: UPSTREAM_FAILED,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
