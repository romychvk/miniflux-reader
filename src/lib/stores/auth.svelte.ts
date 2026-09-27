import { storageGetString, storageSet, storageRemove } from '$lib/storage';
import { normalizeServerUrl } from '$lib/serverUrl';
import type { BackendKind } from '$lib/backend/types';

const BACKEND_KEY = 'backend';

function createAuth() {
	let serverUrl = $state('');
	let apiToken = $state('');
	// Which backend the token belongs to. Absent in storage means Miniflux — every session signed
	// in before the key existed is one.
	let backend = $state<BackendKind>('miniflux');
	// A Miniflux session needs the server the token is for; another engine is this deployment.
	const isLoggedIn = $derived(!!apiToken && (backend !== 'miniflux' || !!serverUrl));

	function init() {
		serverUrl = storageGetString('miniflux_server');
		apiToken = storageGetString('miniflux_api_key');
		backend = (storageGetString(BACKEND_KEY) as BackendKind) || 'miniflux';
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
		backend = 'miniflux';
		storageSet('miniflux_server', serverUrl);
		storageSet('miniflux_api_key', apiToken);
		storageSet(BACKEND_KEY, backend);
	}

	// Sign in against another backend of this build with a token it issued.
	function loginWith(kind: BackendKind, token: string) {
		serverUrl = '';
		apiToken = token.trim();
		backend = kind;
		storageRemove('miniflux_server');
		storageSet('miniflux_api_key', apiToken);
		storageSet(BACKEND_KEY, backend);
	}

	function logout() {
		serverUrl = '';
		apiToken = '';
		backend = 'miniflux';
		storageRemove('miniflux_server');
		storageRemove('miniflux_api_key');
		storageRemove(BACKEND_KEY);
	}

	return {
		get serverUrl() { return serverUrl; },
		get apiToken() { return apiToken; },
		get backend() { return backend; },
		get isLoggedIn() { return isLoggedIn; },
		init,
		login,
		loginWith,
		logout
	};
}

export const auth = createAuth();
