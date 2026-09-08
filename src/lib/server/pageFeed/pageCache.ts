import { fetchSourcePage } from '../sourcePage';

// One fetch per listing page per short window, shared by the wizard preview (which re-runs on
// every selector edit) and the public rss route (which Miniflux may hit for several feeds built
// on the same page, or a user may refresh repeatedly). Module state — adapter-node is one
// long-lived process; `vite dev` resets it on HMR.
//
// Fetching goes through fetchSourcePage: private/loopback targets and unsafe redirects are
// refused, the read is time- and size-capped, and a bot-blocked 403 is retried once. The URL is
// untrusted (it comes signed from a logged-in user or as a JSON body from one), hence the crude
// clear-when-full eviction like /api/rss-bridge.

export interface CachedPage {
	html: string;
	status: number;
	ok: boolean;
	fetchedAt: number;
}

const MAX_ENTRIES = 16;
const MAX_BYTES = 3_000_000; // listing pages run 1–2 MB on media sites

const cache = new Map<string, CachedPage>();
const inflight = new Map<string, Promise<CachedPage>>();

export async function fetchPageCached(url: string, maxAgeMs: number): Promise<CachedPage> {
	const hit = cache.get(url);
	if (hit && Date.now() - hit.fetchedAt < maxAgeMs) return hit;

	const pending = inflight.get(url);
	if (pending) return pending;

	const task = fetchSourcePage(url, { maxBytes: MAX_BYTES })
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
