import type { RequestHandler } from './$types';
import { buildCatalog, matchBridges, normalizeHost, type BridgeMatch } from '$lib/rssbridgeCatalog';
import { requireMinifluxAuth } from '$lib/server/minifluxAuth';
import { safeFetch, type SafeFetchResult } from '$lib/server/safeFetch';

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

// Reads the instance's ?action=detect redirect. RSS-Bridge 301s to ?action=display&bridge=…&<params>
// only when a bridge matches AND a format is supplied; a non-match is a plain 200 with no Location.
// We deliberately don't follow the redirect — its target is the feed itself (a GitHub API round-trip
// for GithubReleaseBridge) — we only want the params encoded in it. Detection is a bonus, so every
// failure degrades to { bridge: null } and the wizard falls back to its form.
async function detectBridge(instance: URL, target: string): Promise<Response> {
	const detectUrl = new URL(instance.toString());
	detectUrl.search = '';
	detectUrl.searchParams.set('action', 'detect');
	detectUrl.searchParams.set('url', target);
	detectUrl.searchParams.set('format', 'Atom');

	let result: SafeFetchResult;
	try {
		result = await safeFetch(detectUrl.toString(), {
			headers: { Accept: 'text/html' },
			maxBytes: 4096,
			timeoutMs: FETCH_TIMEOUT_MS,
			followRedirects: false
		});
	} catch {
		return json({ bridge: null, params: {} });
	}

	if (!result.location) return json({ bridge: null, params: {} });

	let redirect: URL;
	try {
		redirect = new URL(result.location);
	} catch {
		return json({ bridge: null, params: {} });
	}

	const bridge = redirect.searchParams.get('bridge');
	if (!bridge) return json({ bridge: null, params: {} });

	// Everything but the structural keys is a detected parameter (owner/repo, context, u/p/c…),
	// returned verbatim for the wizard to map onto the bridge's declared params.
	const params: Record<string, string> = {};
	for (const [key, value] of redirect.searchParams) {
		if (key === 'action' || key === 'bridge' || key === 'format') continue;
		params[key] = value;
	}
	return json({ bridge, params });
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

	// action=detect is independent of the (1.2MB) catalog: it's the instance resolving the typed URL
	// to a bridge + params on its own. Handle it before the catalog fetch so it stays cheap.
	if (url.searchParams.get('detect')) {
		const detectTarget = url.searchParams.get('url');
		if (!detectTarget) return json({ error: 'Missing url' }, 400);
		return detectBridge(instance, detectTarget);
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
