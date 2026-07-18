import type { RequestHandler } from './$types';
import { requireMinifluxAuth } from '$lib/server/minifluxAuth';
import { safeFetch, SafeFetchError, describeSafeFetchError } from '$lib/server/safeFetch';

// Fetches the raw HTML of an article page server-side so the rule assistant can
// see the original DOM structure (needed to propose scraper_rules for the
// "expand" case). Browser fetch can't do this cross-origin, hence the proxy.
//
// This fetches an arbitrary user-supplied URL, so it's gated two ways: requireMinifluxAuth (no
// anonymous use) and safeFetch (rejects private/loopback targets, validates every redirect hop,
// times out, and streams with a byte cap).

const MAX_BYTES = 80_000;

function clean(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<script\b[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[\s\S]*?<\/style>/gi, '')
		.replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
		.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
		.replace(/\s+\n/g, '\n')
		.trim();
}

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
		const result = await safeFetch(parsed.toString(), {
			headers: {
				// A real UA helps avoid trivial bot blocks on the source site.
				'User-Agent': 'Mozilla/5.0 (compatible; MinifluxReader/1.0; +https://miniflux.app)',
				Accept: 'text/html,application/xhtml+xml'
			},
			// DoS guard on the raw read; clean()+slice below apply the real 80KB semantic cap.
			maxBytes: 3_000_000
		});
		if (!result.ok) {
			return new Response(JSON.stringify({ error: `Source returned ${result.status}` }), {
				status: 502,
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
				status: e.isPolicy ? 400 : 502,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		return new Response(JSON.stringify({ error: 'Failed to fetch page' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
