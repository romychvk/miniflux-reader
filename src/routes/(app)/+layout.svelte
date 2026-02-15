<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
	import TopBar from '$lib/components/topbar/TopBar.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';

	let { children } = $props();
	let ready = $state(false);

	onMount(async () => {
		auth.init();
		if (!auth.isLoggedIn) {
			goto('/login');
			return;
		}

		const mql = window.matchMedia('(max-width: 768px)');
		ui.setMobile(mql.matches);
		mql.addEventListener('change', (e) => ui.setMobile(e.matches));

		await feeds.loadFeeds();
		ready = true;
	});
</script>

{#if ready}
	<div class="flex h-screen bg-gray-50">
		<Sidebar />
		<div class="flex flex-col flex-1 min-w-0">
			<TopBar />
			<main class="flex-1 overflow-y-auto">
				{@render children()}
			</main>
		</div>
	</div>
	<Toast />
{/if}
