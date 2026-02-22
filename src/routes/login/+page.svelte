<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';

	let server = $state('');
	let token = $state('');
	let error = $state('');

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!server || !token) {
			error = 'Both fields are required';
			return;
		}
		auth.login(server, token);
		goto('/');
	}
</script>

<div class="min-h-screen flex items-center justify-center bg-n-100">
	<form onsubmit={handleSubmit} class="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
		<h1 class="text-2xl font-bold mb-6 text-center">Miniflux Reader</h1>

		{#if error}
			<p class="text-red-600 text-sm mb-4">{error}</p>
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
			class="w-full bg-a-600 text-white py-2 px-4 rounded font-medium hover:bg-a-700 transition-colors"
		>
			Login
		</button>
	</form>
</div>
