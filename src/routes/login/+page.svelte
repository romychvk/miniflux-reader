<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import { normalizeServerUrl } from '$lib/serverUrl';

	let server = $state('');
	let token = $state('');
	let error = $state('');
	let validating = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		if (!server || !token) {
			error = 'Both fields are required';
			return;
		}

		let normalized: string;
		try {
			normalized = normalizeServerUrl(server);
		} catch {
			error = 'Enter a valid server URL, e.g. https://miniflux.example.com';
			return;
		}

		// Verify the server + token before persisting, so a wrong value can't strand the user in a
		// logged-in-but-every-call-fails shell. This goes through the proxy, so a 403 here is the
		// ALLOWED_MINIFLUX_SERVER pin rejecting the URL — reported as such rather than as empty UI.
		validating = true;
		try {
			const res = await fetch('/api/proxy/me', {
				headers: { 'X-Auth-Token': token.trim(), 'X-Miniflux-Server': normalized }
			});
			if (!res.ok) {
				error =
					res.status === 403 ? "This server isn't allowed by the reader."
					: res.status === 401 ? 'Invalid API token for this server.'
					: res.status === 502 ? "Couldn't reach that Miniflux server."
					: `Login failed (HTTP ${res.status}).`;
				return;
			}
		} catch {
			error = "Couldn't reach that Miniflux server.";
			return;
		} finally {
			validating = false;
		}

		auth.login(normalized, token);
		goto('/');
	}
</script>

<div class="min-h-screen flex items-center justify-center bg-n-100">
	<form onsubmit={handleSubmit} class="bg-surface p-8 rounded-lg shadow-md w-full max-w-sm">
		<h1 class="text-2xl font-bold mb-6 text-center">Miniflux Reader</h1>

		{#if error}
			<p class="text-danger text-sm mb-4">{error}</p>
		{/if}

		<label class="block mb-4">
			<span class="text-sm font-medium text-n-700">Server URL</span>
			<input
				type="url"
				bind:value={server}
				placeholder="https://miniflux.example.com"
				class="mt-1 block w-full rounded border border-n-300 px-3 py-2 text-sm focus:border-a-500 focus:ring-1 focus:ring-a-500 outline-none"
			/>
		</label>

		<label class="block mb-6">
			<span class="text-sm font-medium text-n-700">API Token</span>
			<input
				type="password"
				bind:value={token}
				placeholder="Your API token"
				class="mt-1 block w-full rounded border border-n-300 px-3 py-2 text-sm focus:border-a-500 focus:ring-1 focus:ring-a-500 outline-none"
			/>
		</label>

		<button
			type="submit"
			disabled={validating}
			class="w-full bg-a-600 text-on-accent py-2 px-4 rounded font-medium hover:bg-a-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
		>
			{validating ? 'Logging in…' : 'Login'}
		</button>
	</form>
</div>
