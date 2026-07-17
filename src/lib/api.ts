import { auth } from '$lib/stores/auth.svelte';
import { ui } from '$lib/stores/ui.svelte';

// Authed fetch to our own server-side helper endpoints (fetch-page, og-image, rss-bridge).
// Like the Miniflux proxy they now require the user's token so they can't be driven anonymously
// (see requireMinifluxAuth). Returns the raw Response — callers read .ok / .json() themselves —
// and preserves the caller's init (signal, method, extra headers).
export function authedFetch(input: string, init?: RequestInit): Promise<Response> {
	return fetch(input, {
		...init,
		headers: {
			'X-Auth-Token': auth.apiToken,
			'X-Miniflux-Server': auth.serverUrl,
			...(init?.headers as Record<string, string>)
		}
	});
}

export async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
	const headers: Record<string, string> = {
		'X-Auth-Token': auth.apiToken,
		'X-Miniflux-Server': auth.serverUrl,
		...(options?.headers as Record<string, string>)
	};

	if (options?.body) {
		headers['Content-Type'] = 'application/json';
	}

	const response = await fetch(`/api/proxy/${path}`, {
		...options,
		headers
	});

	if (!response.ok) {
		const contentType = response.headers.get('content-type');
		let message: string;
		if (contentType?.includes('application/json')) {
			const data = await response.json();
			message = data.error_message || data.error || 'Request failed';
		} else {
			// Upstream or a CDN (e.g. Cloudflare on a slow/unreachable feed source) can return a
			// full HTML error page. Summarize it instead of dumping the whole page into the toast.
			const text = await response.text();
			const isHtml = contentType?.includes('text/html') || /^\s*<(?:!doctype|html)/i.test(text);
			if (isHtml || text.length > 300) {
				const cfCode = text.match(/\bError\s+(\d{3})\b/)?.[1];
				message = cfCode
					? `Cloudflare error ${cfCode} — the feed source timed out or is unreachable`
					: `HTTP ${response.status}`;
			} else {
				message = text.trim() || `HTTP ${response.status}`;
			}
		}
		throw new Error(`${message} (${path})`);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return response.json();
}
