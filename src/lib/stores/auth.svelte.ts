function createAuth() {
	let serverUrl = $state('');
	let apiToken = $state('');
	const isLoggedIn = $derived(!!serverUrl && !!apiToken);

	function init() {
		serverUrl = localStorage.getItem('miniflux_server') || '';
		apiToken = localStorage.getItem('miniflux_api_key') || '';
	}

	function login(server: string, token: string) {
		serverUrl = server.replace(/\/+$/, '');
		apiToken = token;
		localStorage.setItem('miniflux_server', serverUrl);
		localStorage.setItem('miniflux_api_key', apiToken);
	}

	function logout() {
		serverUrl = '';
		apiToken = '';
		localStorage.removeItem('miniflux_server');
		localStorage.removeItem('miniflux_api_key');
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
