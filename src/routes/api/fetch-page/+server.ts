import type { RequestHandler } from './$types';
import { requireMinifluxAuth } from '$lib/server/minifluxAuth';

// Fetches the raw HTML of an article page server-side so the rule assistant can
// see the original DOM structure (needed to propose scraper_rules for the
// "expand" case). Browser fetch can't do this cross-origin, hence the proxy.
//
// This fetches an arbitrary user-supplied URL, so it must not be usable anonymously:
// requireMinifluxAuth gates it behind a valid Miniflux token. Host-level SSRF filtering
// (private/loopback ranges, redirect checks) and a streaming byte cap are still TODO — see safeFetch.

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
		const res = await fetch(parsed.toString(), {
			headers: {
				// A real UA helps avoid trivial bot blocks on the source site.
				'User-Agent':
					'Mozilla/5.0 (compatible; MinifluxReader/1.0; +https://miniflux.app)',
				Accept: 'text/html,application/xhtml+xml'
			}
		});
		if (!res.ok) {
			return new Response(JSON.stringify({ error: `Source returned ${res.status}` }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		const raw = await res.text();
		const html = clean(raw).slice(0, MAX_BYTES);
		return new Response(JSON.stringify({ html }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch {
		return new Response(JSON.stringify({ error: 'Failed to fetch page' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
