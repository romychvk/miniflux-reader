import { authedFetch } from '$lib/api';
import type { PageFeedConfig, PageFeedPreview } from '$lib/pageFeed';

// Browser side of a page feed: asks the server to fetch the listing page, score selectors,
// extract items and sign the feed URL. Kept apart from pageFeed.ts so that one stays pure.

export interface PageFeedPreviewOptions {
	candidates?: string[]; // AI-suggested selectors for the server to score
	signal?: AbortSignal;
}

export type PageFeedPreviewRequest = Partial<PageFeedConfig> & { pageUrl: string };

export async function previewPageFeed(
	config: PageFeedPreviewRequest,
	opts: PageFeedPreviewOptions = {}
): Promise<PageFeedPreview> {
	const res = await authedFetch('/api/page-feed/preview', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...config, candidates: opts.candidates }),
		signal: opts.signal
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `Preview failed (${res.status})`);
	return data as PageFeedPreview;
}
