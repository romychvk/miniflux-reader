import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { requireMinifluxAuth } from '$lib/server/minifluxAuth';
import { safeFetch, SafeFetchError } from '$lib/server/safeFetch';
import { archiveKey, hasImage, pruneArchive, readImage, writeImage } from '$lib/server/imageStore';
import { sniffImageType } from '$lib/server/imageTypes';

// The image archive's two halves.
//
// POST stores: authenticated, takes a batch of source URLs and downloads whatever isn't held yet.
// GET serves: NOT authenticated, because an <img> cannot carry the X-Auth-Token header the rest of
// the app authenticates with. That is safe here only because GET never fetches anything — it reads
// the store or 404s. There is no URL a caller can name that would make this server reach out, so
// the endpoint is not an open proxy; the worst it leaks is whether a given URL was archived.

const MAX_IMAGE_BYTES = Number(env.IMAGE_ARCHIVE_MAX_IMAGE_BYTES || 8 * 1024 * 1024);
const MAX_TOTAL_BYTES = Number(env.IMAGE_ARCHIVE_MAX_TOTAL_BYTES || 1024 * 1024 * 1024);
const MAX_URLS_PER_BATCH = 100;
const DOWNLOAD_CONCURRENCY = 4;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

export const GET: RequestHandler = async ({ url }) => {
	const target = url.searchParams.get('url');
	if (!target) return json({ error: 'Missing url' }, 400);

	const image = await readImage(archiveKey(target));
	if (!image) return json({ error: 'Not archived' }, 404);

	return new Response(new Uint8Array(image.bytes), {
		headers: {
			'Content-Type': image.contentType,
			// Content-addressed by the source URL, so a hit is the same bytes forever.
			'Cache-Control': 'public, max-age=31536000, immutable',
			// Belt and braces on top of the raster-only allowlist: never let a browser talk itself
			// into treating these bytes as anything but the image type we vetted.
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; sandbox"
		}
	});
};

type Outcome = 'stored' | 'held' | 'failed';

async function archiveOne(rawUrl: string): Promise<Outcome> {
	const key = archiveKey(rawUrl);
	if (await hasImage(key)) return 'held';

	try {
		const res = await safeFetch(rawUrl, {
			maxBytes: MAX_IMAGE_BYTES,
			timeoutMs: 15_000,
			asBytes: true,
			headers: {
				// Same self-identifying agent the fetch-page and og-image endpoints use. Plenty of
				// image hosts answer 403 to a request with no User-Agent at all, which would have
				// made the archive fail for a silly reason on perfectly willing sources.
				// Deliberately no Referer: hotlink protection is one of the things being worked
				// around here, and those checks pass a request that carries none.
				'User-Agent': 'Mozilla/5.0 (compatible; MinifluxReader/1.0; +https://miniflux.app)',
				Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
			}
		});
		if (!res.ok || !res.bytes) return 'failed';

		// A blocked source answers with an HTML challenge or error page, sometimes even under an
		// image content-type. sniffImageType refuses anything whose bytes don't match its label,
		// so a failure is never archived as though it were the picture.
		const contentType = sniffImageType(res.bytes, res.contentType);
		if (!contentType) return 'failed';

		await writeImage(key, res.bytes, contentType, rawUrl);
		return 'stored';
	} catch (e) {
		if (e instanceof SafeFetchError) return 'failed';
		throw e;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const auth = await requireMinifluxAuth(request);
	if (auth instanceof Response) return auth;

	let payload: { urls?: unknown };
	try {
		payload = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, 400);
	}
	if (!Array.isArray(payload.urls)) return json({ error: 'Expected { urls: string[] }' }, 400);

	// Dedupe before doing any work: one article's gallery routinely repeats a picture, and a batch
	// covers a whole page of entries.
	const urls = [
		...new Set(
			payload.urls.filter(
				(u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)
			)
		)
	].slice(0, MAX_URLS_PER_BATCH);

	const counts: Record<Outcome, number> = { stored: 0, held: 0, failed: 0 };
	let next = 0;
	async function worker() {
		while (next < urls.length) {
			const url = urls[next++];
			counts[await archiveOne(url)]++;
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, urls.length) }, worker)
	);

	// Only a write can push the archive past its budget, so this is the one moment worth checking.
	if (counts.stored > 0) {
		try {
			await pruneArchive(MAX_TOTAL_BYTES);
		} catch {
			// eviction is housekeeping — never fail an archiving request over it
		}
	}

	return json(counts);
};
