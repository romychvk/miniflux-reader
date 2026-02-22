<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/stores/auth.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
	import TopBar from '$lib/components/topbar/TopBar.svelte';
	import ArticlePanel from '$lib/components/content/ArticlePanel.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';

	let { children } = $props();
	let ready = $state(false);

	const isArticleRoute = $derived(page.route.id?.includes('/article/') ?? false);
	const showArticlePanel = $derived(
		ui.layoutMode === 'three-column' && !ui.isMobile && !isArticleRoute
	);

	onMount(async () => {
		auth.init();
		if (!auth.isLoggedIn) {
			goto('/login');
			return;
		}

		const mql = window.matchMedia('(max-width: 768px)');
		const onMediaChange = (e: MediaQueryListEvent) => ui.setMobile(e.matches);
		ui.setMobile(mql.matches);
		mql.addEventListener('change', onMediaChange);
		ui.initSidebarWidth();
		ui.initLayoutMode();
		ui.initViewMode();
		ui.initArticlePanelWidth();
		theme.init();

		await feeds.loadFeeds();
		ready = true;

		return () => {
			mql.removeEventListener('change', onMediaChange);
		};
	});
</script>

{#if ready}
	<div class="flex h-screen bg-n-50">
		<Sidebar />
		<div class="flex flex-col flex-1 min-w-0">
			<TopBar />
			<main class="flex-1 overflow-y-auto">
				{@render children()}
			</main>
		</div>
		{#if showArticlePanel}
			<ArticlePanel />
		{/if}
	</div>
	<Toast />
{/if}
