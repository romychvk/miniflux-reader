import { storageGetString, storageSet, storageRemove } from '$lib/storage';

function createAuth() {
	let serverUrl = $state('');
	let apiToken = $state('');
	const isLoggedIn = $derived(!!serverUrl && !!apiToken);

	function init() {
		serverUrl = storageGetString('miniflux_server');
		apiToken = storageGetString('miniflux_api_key');
	}

	function login(server: string, token: string) {
		serverUrl = server.replace(/\/+$/, '');
		apiToken = token;
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
