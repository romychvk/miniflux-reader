import type { Handle } from '@sveltejs/kit';

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

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');

	if (NO_STORE_PREFIXES.some((p) => event.url.pathname.startsWith(p))) {
		response.headers.set('Cache-Control', 'no-store');
	}

	return response;
};
