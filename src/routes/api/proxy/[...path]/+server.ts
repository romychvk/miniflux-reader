import type { RequestHandler } from './$types';
import { isAllowedMinifluxServer } from '$lib/server/minifluxAuth';

// Catch-all proxy to the user's Miniflux instance. `server` comes from a caller-supplied header,
// so it's pinned to ALLOWED_MINIFLUX_SERVER (when set) — without that check this is an open SSRF:
// anyone could point it at an internal host. A timeout stops a hostile/unreachable host hanging us.
const ALLOWED_METHODS = ['GET', 'PUT', 'POST', 'DELETE'];
const TIMEOUT_MS = 60_000; // generous — covers slow fetch-content re-scrapes, but no infinite hang

export const fallback: RequestHandler = async ({ request, params, url }) => {
	if (!ALLOWED_METHODS.includes(request.method)) {
		return new Response('Method not allowed', { status: 405 });
	}

	const server = request.headers.get('x-miniflux-server');
	const token = request.headers.get('x-auth-token');

	if (!server || !token) {
		return new Response(JSON.stringify({ error: 'Missing server or token' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!isAllowedMinifluxServer(server)) {
		return new Response(JSON.stringify({ error: 'Server not allowed' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!params.path || params.path.includes('..') || params.path.startsWith('/')) {
		return new Response(JSON.stringify({ error: 'Invalid path' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const target = new URL(`/v1/${params.path}`, server);

	if (!target.pathname.startsWith('/v1/')) {
		return new Response(JSON.stringify({ error: 'Invalid path' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	for (const [key, value] of url.searchParams) {
		target.searchParams.set(key, value);
	}

	const fetchOptions: RequestInit = {
		method: request.method,
		headers: { 'X-Auth-Token': token },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	};

	if (request.method !== 'GET' && request.method !== 'HEAD') {
		const body = await request.text();
		if (body) {
			fetchOptions.body = body;
			(fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
		}
	}

	try {
		const response = await fetch(target.toString(), fetchOptions);
		const contentType = response.headers.get('content-type');

		if (response.status === 204) {
			return new Response(null, { status: 204 });
		}

		if (contentType?.includes('application/json')) {
			const data = await response.json();
			return new Response(JSON.stringify(data), {
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const buffer = await response.arrayBuffer();
		return new Response(buffer, {
			status: response.status,
			headers: { 'Content-Type': contentType || 'application/octet-stream' }
		});
	} catch {
		return new Response(JSON.stringify({ error: 'Failed to reach Miniflux server' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
