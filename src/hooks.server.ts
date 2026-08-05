import type { Handle, RequestEvent } from '@sveltejs/kit';
import { createRateLimiter } from '$lib/server/rateLimit';

// Baseline response hardening applied to every route.
//
// Deliberately NOT set here:
//   - Content-Security-Policy — SvelteKit hashes its own inline hydration script, so a
//     hand-rolled CSP would break the page. It belongs in svelte.config (`kit.csp`) and is
//     added together with the {@html} sanitization pass, where it can be tested against the app.
//   - Referrer-Policy — feed images are hotlinked from source sites, some of which gate on the
//     Referer header. Stripping/shortening it would break those images, so we leave it default.

// Authenticated, per-user responses share a URL across users (the token is a header, not the
// path), so a shared CDN/proxy must never cache them.
const NO_STORE_PREFIXES = ['/api/settings', '/api/proxy', '/api/ai'];

// Per-IP limits on the API surface (single-process in-memory buckets — see rateLimit.ts).
// Budgets track real client behavior: the proxy takes an icon fan-out + entry pages on boot,
// og-image fires per card but is cached client-side, the AI proxy is slow/expensive upstream.
// First match wins — specific prefixes before broad ones.
const limiter = createRateLimiter([
	{ prefix: '/api/ai', capacity: 20, refillPerMinute: 10 },
	{ prefix: '/api/fetch-page', capacity: 30, refillPerMinute: 20 },
	{ prefix: '/api/og-image', capacity: 120, refillPerMinute: 60 },
	{ prefix: '/api/rss-bridge', capacity: 30, refillPerMinute: 20 },
	{ prefix: '/api/settings', capacity: 30, refillPerMinute: 30 },
	{ prefix: '/api/proxy', capacity: 300, refillPerMinute: 300 }
]);

// Client IP for bucketing. Cloudflare's header when fronted by it, else the first XFF hop, else
// the socket peer. These headers are spoofable when the app is exposed directly — the limiter is
// abuse damping for a demo deployment, not an auth boundary.
function clientIp(event: RequestEvent): string {
	return (
		event.request.headers.get('cf-connecting-ip') ||
		event.request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
		event.getClientAddress()
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/')) {
		const verdict = limiter.check(event.url.pathname, clientIp(event));
		if (!verdict.allowed) {
			return new Response(JSON.stringify({ error: 'Too many requests' }), {
				status: 429,
				headers: {
					'Content-Type': 'application/json',
					'Retry-After': String(verdict.retryAfterSeconds),
					'Cache-Control': 'no-store'
				}
			});
		}
	}

	const response = await resolve(event);

	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');

	if (NO_STORE_PREFIXES.some((p) => event.url.pathname.startsWith(p))) {
		response.headers.set('Cache-Control', 'no-store');
	}

	return response;
};
