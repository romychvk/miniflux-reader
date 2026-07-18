import type { RequestHandler } from './$types';
import { requireMinifluxAuth } from '$lib/server/minifluxAuth';
import { safeFetch, SafeFetchError, describeSafeFetchError } from '$lib/server/safeFetch';

// Default thumbnail source: fetch an article page server-side and read its Open Graph /
// Twitter image meta tag. Used for entries whose content has no usable <img> and no image
// enclosure, when the feed has no custom cover rule (those go through /api/fetch-page +
// the client-side CSS extractor instead). Results are cached client-side, so this runs at
// most once per article. Gated like /api/fetch-page: requireMinifluxAuth + safeFetch
// (private-address blocklist, redirect validation, timeout, streaming byte cap).

function metaContent(html: string, key: string): string | null {
	// Match a <meta> tag whose property/name equals `key`, in any attribute order.
	const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
	const tag = html.match(re)?.[0];
	if (!tag) return null;
	return tag.match(/content=["']([^"']+)["']/i)?.[1] ?? null;
}

export const GET: RequestHandler = async ({ request, url }) => {
	const auth = await requireMinifluxAuth(request);
	if (auth instanceof Response) return auth;

	const target = url.searchParams.get('url');
	const fail = (status: number, error: string) =>
		new Response(JSON.stringify({ error }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});

	if (!target) return fail(400, 'Missing url');

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return fail(400, 'Invalid url');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return fail(400, 'Only http(s) urls are allowed');
	}

	try {
		const result = await safeFetch(parsed.toString(), {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; MinifluxReader/1.0; +https://miniflux.app)',
				Accept: 'text/html,application/xhtml+xml'
			},
			maxBytes: 200_000 // og/twitter meta live in <head>
		});
		if (!result.ok) return fail(502, `Source returned ${result.status}`);

		const html = result.body;
		const raw =
			metaContent(html, 'og:image') ||
			metaContent(html, 'og:image:url') ||
			metaContent(html, 'twitter:image') ||
			metaContent(html, 'twitter:image:src');

		// Resolve relative URLs against the page, and return null (not error) when absent.
		let image: string | null = null;
		if (raw) {
			try {
				image = new URL(raw, parsed).toString();
			} catch {
				image = null;
			}
		}

		return new Response(JSON.stringify({ url: image }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		if (e instanceof SafeFetchError) return fail(e.isPolicy ? 400 : 502, describeSafeFetchError(e));
		return fail(502, 'Failed to fetch page');
	}
};
