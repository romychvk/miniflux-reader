import { storageGetString, storageSet, storageRemove } from '$lib/storage';
import { normalizeServerUrl } from '$lib/serverUrl';

function createAuth() {
	let serverUrl = $state('');
	let apiToken = $state('');
	const isLoggedIn = $derived(!!serverUrl && !!apiToken);

	function init() {
		serverUrl = storageGetString('miniflux_server');
		apiToken = storageGetString('miniflux_api_key');
	}

	function login(server: string, token: string) {
		// Normalize to the origin so a pasted `/v1/` path (or trailing slash / stray whitespace)
		// can't leave the stored server mismatching ALLOWED_MINIFLUX_SERVER. Falls back to a light
		// clean-up if the value somehow isn't a parseable URL (the login form validates first).
		try {
			serverUrl = normalizeServerUrl(server);
		} catch {
			serverUrl = server.trim().replace(/\/+$/, '');
		}
		apiToken = token.trim();
		storageSet('miniflux_server', serverUrl);
		storageSet('miniflux_api_key', apiToken);
	}

	function logout() {
		serverUrl = '';
		apiToken = '';
		storageRemove('miniflux_server');
		storageRemove('miniflux_api_key');
	}

	return {
		get serverUrl() { return serverUrl; },
		get apiToken() { return apiToken; },
		get isLoggedIn() { return isLoggedIn; },
		init,
		login,
		logout
	};
}

export const auth = createAuth();
