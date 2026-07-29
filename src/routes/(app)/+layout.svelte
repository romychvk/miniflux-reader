<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/stores/auth.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { aiConfig } from '$lib/stores/aiConfig.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { refresh } from '$lib/stores/refresh.svelte';
	import { settingsSync } from '$lib/settingsSync.svelte';
	import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
	import TopBar from '$lib/components/topbar/TopBar.svelte';
	import ArticlePanel from '$lib/components/content/ArticlePanel.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';
	import RefreshIndicator from '$lib/components/ui/RefreshIndicator.svelte';
	import Lightbox from '$lib/components/ui/Lightbox.svelte';
	import FilterCreateModal from '$lib/components/ui/FilterCreateModal.svelte';
	import FeedFiltersModal from '$lib/components/ui/FeedFiltersModal.svelte';

	let { children } = $props();
	let ready = $state(false);

	// The full-page article route carries its own header (a breadcrumbs row above the H1 plus a
	// floating Close button), so the app top bar is hidden there and the article gets the full
	// viewport height. Settings keeps the top bar — it still uses it to navigate back.
	const isArticleView = $derived(page.route.id?.includes('/article/') ?? false);
	const isFullView = $derived(isArticleView || (page.route.id?.includes('/settings') ?? false));
	const showArticlePanel = $derived(
		ui.layoutMode === 'three-column' && !ui.isMobile && !isFullView
	);

	// onMount stays synchronous so the matchMedia cleanup is actually registered: a cleanup
	// returned after an `await` runs in a detached microtask that Svelte never sees, leaking
	// the listener. The async boot sequence runs alongside via boot().
	onMount(() => {
		const mql = window.matchMedia('(max-width: 768px)');
		const onMediaChange = (e: MediaQueryListEvent) => ui.setMobile(e.matches);
		mql.addEventListener('change', onMediaChange);
		ui.setMobile(mql.matches);

		void boot();

		return () => {
			mql.removeEventListener('change', onMediaChange);
			refresh.stopPolling();
		};
	});

	async function boot() {
		auth.init();
		if (!auth.isLoggedIn) {
			goto('/login');
			return;
		}

		// Reconcile settings with the server before any store hydrates from localStorage.
		// A changed pull reloads the page — bail out rather than racing loadFeeds() against it.
		if ((await settingsSync.syncOnBoot()) === 'reloading') return;

		ui.initSidebarWidth();
		ui.initLayoutMode();
		ui.initViewMode();
		ui.initArticlePanelWidth();
		ui.initAutoMarkRead();
		entries.initShowAll();
		theme.init();
		aiConfig.init();
		// All init-time localStorage reads are done — safe to start watching for changes.
		settingsSync.start();

		await feeds.loadFeeds();
		refresh.startPolling();
		ready = true;
	}
</script>

{#if ready}
	<div class="flex h-screen bg-n-50">
		<Sidebar />
		<div class="flex flex-col flex-1 min-w-0">
			{#if !isArticleView}
				<TopBar />
			{/if}
			<div class="relative flex-1 min-h-0 flex flex-col">
				<main class="flex-1 overflow-y-auto">
					{@render children()}
				</main>
				<RefreshIndicator />
			</div>
		</div>
		{#if showArticlePanel}
			<ArticlePanel />
		{/if}
	</div>
	<Toast />
	<Lightbox />
	{#if ui.filterSeed}
		{#key ui.filterSeed}
			<FilterCreateModal seed={ui.filterSeed} />
		{/key}
	{/if}
	{#if ui.filtersFeedId != null}
		{#key ui.filtersFeedId}
			<FeedFiltersModal feedId={ui.filtersFeedId} />
		{/key}
	{/if}
{/if}
