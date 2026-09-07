import { safeFetch } from '../safeFetch';

// One fetch per listing page per short window, shared by the wizard preview (which re-runs on
// every selector edit) and the public rss route (which Miniflux may hit for several feeds built
// on the same page, or a user may refresh repeatedly). Module state — adapter-node is one
// long-lived process; `vite dev` resets it on HMR.
//
// Fetching goes through safeFetch: private/loopback targets and unsafe redirects are refused,
// the read is time- and size-capped. The URL is untrusted (it comes signed from a logged-in user
// or as a JSON body from one), hence the crude clear-when-full eviction like /api/rss-bridge.

export interface CachedPage {
	html: string;
	status: number;
	ok: boolean;
	fetchedAt: number;
}

const MAX_ENTRIES = 16;
const MAX_BYTES = 3_000_000; // listing pages run 1–2 MB on media sites
const TIMEOUT_MS = 12_000; // Miniflux gives a feed 20 s in total — leave room to parse
// Same UA as /api/fetch-page: a real-looking one avoids trivial bot blocks on the source site.
const USER_AGENT = 'Mozilla/5.0 (compatible; MinifluxReader/1.0; +https://miniflux.app)';

const cache = new Map<string, CachedPage>();
const inflight = new Map<string, Promise<CachedPage>>();

export async function fetchPageCached(url: string, maxAgeMs: number): Promise<CachedPage> {
	const hit = cache.get(url);
	if (hit && Date.now() - hit.fetchedAt < maxAgeMs) return hit;

	const pending = inflight.get(url);
	if (pending) return pending;

	const task = safeFetch(url, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
		maxBytes: MAX_BYTES,
		timeoutMs: TIMEOUT_MS
	})
		.then((result) => {
			const page: CachedPage = {
				html: result.body,
				status: result.status,
				ok: result.ok,
				fetchedAt: Date.now()
			};
			// Failures aren't cached: a 503 shouldn't be replayed for a minute.
			if (page.ok) {
				if (cache.size >= MAX_ENTRIES) cache.clear();
				cache.set(url, page);
			}
			return page;
		})
		.finally(() => inflight.delete(url));

	inflight.set(url, task);
	return task;
}
