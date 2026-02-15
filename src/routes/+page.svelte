<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import App from '$lib/components/App.svelte';

	let ready = $state(false);

	onMount(() => {
		auth.init();
		if (!auth.isLoggedIn) {
			goto('/login');
		} else {
			ready = true;
		}
	});
</script>

{#if ready}
	<App />
{/if}
