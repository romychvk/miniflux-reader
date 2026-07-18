import { env } from '$env/dynamic/private';

// Shared credential check for the server-side helper endpoints (fetch-page, og-image,
// rss-bridge). Each fetches an arbitrary URL on the caller's behalf, so — unlike the Miniflux
// proxy, whose token is inherently required to reach anything — they must not be usable
// anonymously. We validate the caller's token against their Miniflux instance's /v1/me,
// cached briefly so a burst of thumbnail lookups doesn't trigger a round-trip each.
//
// Scope: this proves the caller holds a valid token for *some* reachable Miniflux instance.
// It does NOT by itself stop SSRF — an attacker could point x-miniflux-server at a server that
// rubber-stamps any token. Set ALLOWED_MINIFLUX_SERVER in production to pin the instance and
// close that; private/loopback address filtering and redirect checks land with safeFetch.

const AUTH_TTL_MS = 5 * 60_000;
const ME_TIMEOUT_MS = 10_000;

const authCache = new Map<string, { userId: number; expires: number }>();

export interface MinifluxIdentity {
	userId: number;
	server: string; // normalized (no trailing slash)
	token: string;
}

function fail(status: number, error: string): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

// Whether a raw x-miniflux-server header value is allowed by the ALLOWED_MINIFLUX_SERVER pin.
// When no pin is set (dev), everything is allowed. Shared with the proxy so a caller can't point
// any server-side fetch at an arbitrary (e.g. internal) host.
export function isAllowedMinifluxServer(server: string): boolean {
	const pin = env.ALLOWED_MINIFLUX_SERVER?.replace(/\/+$/, '');
	return !pin || server.replace(/\/+$/, '') === pin;
}

// Returns the caller's identity, or a Response to return as-is when the check fails.
export async function requireMinifluxAuth(request: Request): Promise<MinifluxIdentity | Response> {
	const server = request.headers.get('x-miniflux-server')?.replace(/\/+$/, '');
	const token = request.headers.get('x-auth-token');
	if (!server || !token) return fail(401, 'Missing server or token');

	if (!isAllowedMinifluxServer(server)) return fail(403, 'Server not allowed');

	const cacheKey = `${server}|${token}`;
	const hit = authCache.get(cacheKey);
	if (hit && hit.expires > Date.now()) return { userId: hit.userId, server, token };

	let res: Response;
	try {
		res = await fetch(new URL('/v1/me', server), {
			headers: { 'X-Auth-Token': token },
			signal: AbortSignal.timeout(ME_TIMEOUT_MS)
		});
	} catch {
		return fail(502, 'Failed to reach Miniflux server');
	}
	if (!res.ok) return fail(401, 'Invalid credentials');

	const me = (await res.json().catch(() => null)) as { id?: unknown } | null;
	if (typeof me?.id !== 'number') return fail(502, 'Unexpected Miniflux response');

	if (authCache.size > 100) authCache.clear();
	authCache.set(cacheKey, { userId: me.id, expires: Date.now() + AUTH_TTL_MS });
	return { userId: me.id, server, token };
}
