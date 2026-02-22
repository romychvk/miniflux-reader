import { auth } from '$lib/stores/auth.svelte';
import { ui } from '$lib/stores/ui.svelte';

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
			message = await response.text();
		}
		throw new Error(`${message} (${path})`);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return response.json();
}
