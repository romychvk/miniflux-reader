import type { RequestHandler } from './$types';
import { requireMinifluxAuth } from '$lib/server/minifluxAuth';
import { SafeFetchError, describeSafeFetchError } from '$lib/server/safeFetch';
import { clean } from '$lib/server/htmlClean';
import { fetchPageCached } from '$lib/server/pageFeed/pageCache';
import { UPSTREAM_FAILED } from '$lib/server/sourcePage';
import { parsePreviewRequest } from '$lib/server/pageFeed/validate';
import {
	InvalidPatternError,
	InvalidSelectorError,
	extractItems,
	pageTitle,
	parsePage,
	suggestSelectors
} from '$lib/server/pageFeed/extract';
import { buildSignedPageFeedPath } from '$lib/server/pageFeed/sign';
import { getPageFeedSecret, pageFeedPublicOrigin } from '$lib/server/pageFeed/secret';

// The wizard's (and Feed Settings') view of a page feed before it exists: fetches the listing
// page server-side, scores selector candidates, extracts items with the chosen selector and
// mints the signed feed URL. Preview and the public rss route share the extractor, so what the
// user sees here is what Miniflux will get.
//
// Fetches an arbitrary user-supplied URL, so it's gated like /api/fetch-page: requireMinifluxAuth
// plus safeFetch, and rate-limited in hooks.server.ts.

const PAGE_MAX_AGE_MS = 5 * 60_000; // selector iteration shouldn't re-download a 1.6 MB page
const ITEMS_MAX = 50;
const SAMPLE_MAX = 50_000; // what the AI selector prompt reads (buildSelectorUserMessage's cap)

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

export const POST: RequestHandler = async ({ request, url }) => {
	const auth = await requireMinifluxAuth(request);
	if (auth instanceof Response) return auth;

	const parsed = parsePreviewRequest(await request.json().catch(() => null));
	if ('error' in parsed) return json(400, { error: parsed.error });
	const { config, candidates } = parsed;

	let page;
	try {
		page = await fetchPageCached(config.pageUrl, PAGE_MAX_AGE_MS);
	} catch (e) {
		if (e instanceof SafeFetchError) {
			return json(e.isPolicy ? 400 : UPSTREAM_FAILED, { error: describeSafeFetchError(e) });
		}
		return json(UPSTREAM_FAILED, { error: 'Failed to fetch the page' });
	}
	if (!page.ok) return json(UPSTREAM_FAILED, { error: `Source returned ${page.status}` });

	const $ = parsePage(page.html);
	// Suggestions cost a dozen extractions over the whole page, so only on the first call
	// (no selector yet) or when the AI handed over candidates to score.
	const wantSuggestions = !config.itemSelector || candidates.length > 0;
	const suggestions = wantSuggestions ? suggestSelectors($, config.pageUrl, candidates) : [];
	const sample = clean(page.html);
	const body = {
		pageTitle: pageTitle($),
		suggestions,
		htmlSample: sample.slice(0, SAMPLE_MAX),
		truncated: sample.length > SAMPLE_MAX
	};
	if (!config.itemSelector) return json(200, body);

	try {
		const result = extractItems($, config.pageUrl, config);
		const feedUrl = pageFeedPublicOrigin(url) + buildSignedPageFeedPath(config, getPageFeedSecret());
		return json(200, {
			...body,
			items: result.items.slice(0, ITEMS_MAX),
			matched: result.matched,
			feedUrl
		});
	} catch (e) {
		if (e instanceof InvalidSelectorError) return json(400, { error: 'Invalid CSS selector' });
		if (e instanceof InvalidPatternError) {
			return json(400, { error: 'Link pattern is not a valid regular expression' });
		}
		throw e;
	}
};
