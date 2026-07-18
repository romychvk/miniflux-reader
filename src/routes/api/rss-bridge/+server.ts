import type { RequestHandler } from './$types';
import { buildCatalog, matchBridges, normalizeHost, type BridgeMatch } from '$lib/rssbridgeCatalog';
import { requireMinifluxAuth } from '$lib/server/minifluxAuth';
import { safeFetch } from '$lib/server/safeFetch';

// Answers "does the user's RSS-Bridge instance have a ready-made bridge for this domain?".
//
// The instance's ?action=list is ~1.2MB (520 bridges), which is why this can't reuse /api/fetch-page
// (that one caps at 80KB and cleans HTML). We fetch it once per instance, keep the *parsed* catalog
// (~300KB, not the raw string), and answer each lookup from memory — a match response is 1-5KB.
//
// The cache is module state, which works because adapter-node runs one long-lived process. `vite dev`
// resets it on HMR, so expect a re-fetch after editing this file in dev.
//
// It also has to live here rather than in localStorage: settingsBackup.ts treats every unknown key as
// syncable, so a client-side cache would be pushed into the /api/settings blob (512KB cap) and end up
// in the user's settings export.
//
// SSRF note: `instance` is a user-supplied URL fetched server-side. Auth-gated like /api/fetch-page
// (requireMinifluxAuth); host-level filtering of private/loopback addresses is still TODO — see safeFetch.

const TTL_MS = 6 * 60 * 60 * 1000; // bridge lists only change when the instance is redeployed
const MAX_BYTES = 8_000_000; // the real payload is ~1.2MB; this guards a hostile/huge instance
const FETCH_TIMEOUT_MS = 15_000;
const MAX_INSTANCES = 8;

interface CacheEntry {
	catalog: BridgeMatch[];
	expires: number;
}

const catalogCache = new Map<string, CacheEntry>();
// Warm-on-mount and a fast submit can race; without this both would pull 1.2MB.
const inflight = new Map<string, Promise<BridgeMatch[]>>();

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

// Cache on the normalized instance, or `https://x/` and `https://x` become two 1.2MB fetches.
function instanceKey(instance: URL): string {
	return instance.origin + instance.pathname.replace(/\/+$/, '');
}

async function fetchCatalog(instance: URL): Promise<BridgeMatch[]> {
	const listUrl = new URL(instance.toString());
	listUrl.search = '';
	listUrl.searchParams.set('action', 'list');

	// safeFetch validates the address (private/loopback blocked), follows redirects safely, times
	// out, and streams up to MAX_BYTES — replacing the old content-length + text-length guards. A
	// hostile instance that streams past the cap gets truncated, so JSON.parse throws → 502 below.
	const result = await safeFetch(listUrl.toString(), {
		headers: { Accept: 'application/json' },
		maxBytes: MAX_BYTES,
		timeoutMs: FETCH_TIMEOUT_MS
	});
	if (!result.ok) throw new Error(`Instance returned ${result.status}`);

	return buildCatalog(JSON.parse(result.body));
}

async function getCatalog(instance: URL): Promise<BridgeMatch[]> {
	const key = instanceKey(instance);

	const hit = catalogCache.get(key);
	if (hit && hit.expires > Date.now()) return hit.catalog;

	const pending = inflight.get(key);
	if (pending) return pending;

	const task = fetchCatalog(instance)
		.then((catalog) => {
			// `instance` is an untrusted query param, so the cache is attacker-growable — same crude
			// eviction as /api/settings.
			if (catalogCache.size >= MAX_INSTANCES) catalogCache.clear();
			catalogCache.set(key, { catalog, expires: Date.now() + TTL_MS });
			return catalog;
		})
		.finally(() => inflight.delete(key));

	inflight.set(key, task);
	return task;
}

export const GET: RequestHandler = async ({ request, url }) => {
	const auth = await requireMinifluxAuth(request);
	if (auth instanceof Response) return auth;

	const instanceParam = url.searchParams.get('instance');
	if (!instanceParam) return json({ error: 'Missing instance' }, 400);

	let instance: URL;
	try {
		instance = new URL(instanceParam);
	} catch {
		return json({ error: 'Invalid instance' }, 400);
	}
	if (instance.protocol !== 'http:' && instance.protocol !== 'https:') {
		return json({ error: 'Only http(s) instances are allowed' }, 400);
	}

	let catalog: BridgeMatch[];
	try {
		catalog = await getCatalog(instance);
	} catch {
		return json({ error: 'Failed to read the bridge list' }, 502);
	}

	// Called while the user is still typing, so the cold fetch never lands in the submit path.
	if (url.searchParams.get('warm')) return json({ ok: true, total: catalog.length });

	const target = url.searchParams.get('url');
	if (!target) return json({ error: 'Missing url' }, 400);

	return json({ host: normalizeHost(target), bridges: matchBridges(catalog, target) });
};
