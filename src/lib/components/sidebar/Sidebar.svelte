<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { LogOut, Plus, Settings, Square, SquareCheck, Circle } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import FeedTree from './FeedTree.svelte';
	import FeedAddModal from '$lib/components/ui/FeedAddModal.svelte';

	let showAddModal = $state(false);
	let settingsDropdownOpen = $state(false);

	const isArticleView = $derived(page.route.id?.includes('/article/') ?? false);

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.settings-dropdown')) {
			settingsDropdownOpen = false;
		}
	}

	function handleLogout() {
		auth.logout();
		goto('/login');
	}

	let resizing = $state(false);

	function onResizeStart(e: MouseEvent) {
		e.preventDefault();
		resizing = true;
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';
		const startX = e.clientX;
		const startWidth = ui.sidebarWidth;

		function onMouseMove(e: MouseEvent) {
			ui.setSidebarWidth(startWidth + e.clientX - startX);
		}

		function onMouseUp() {
			resizing = false;
			document.body.style.userSelect = '';
			document.body.style.cursor = '';
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		}

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}
</script>

{#snippet logoutButton()}
	<div class="border-t border-n-200 p-3 mt-auto">
		<button
			onclick={handleLogout}
			class="flex items-center gap-2 text-sm text-n-500 hover:text-n-700 transition-colors w-full cursor-pointer"
		>
			<LogOut size={16} />
			Logout
		</button>
	</div>
{/snippet}

{#snippet settingsButton()}
	<div class="flex items-center relative settings-dropdown">
		<button
			onclick={() => settingsDropdownOpen = !settingsDropdownOpen}
			title="Settings"
			class="text-n-700 hover:bg-n-200 p-2 rounded-full transition-colors"
		>
			<Settings size={20} />
		</button>
		{#if settingsDropdownOpen}
			<div class="absolute -right-4 top-full mt-1 bg-surface border border-n-200 rounded-md shadow-lg py-2 z-50 min-w-56">
				<button
					onclick={() => ui.toggleAutoMarkRead()}
					class="w-full text-left px-4 py-2.5 text-sm hover:bg-n-100 flex items-center gap-2"
				>
					{#if ui.autoMarkReadOnScroll}
						<SquareCheck size={18} class="shrink-0 text-a-600" />
					{:else}
						<Square size={18} class="shrink-0 text-n-500" />
					{/if}
					Mark read on scroll
				</button>

				<div class="border-t border-n-200 mt-1 py-4">
					<div class="px-4 text-sm mb-3 font-medium text-n-500">Theme</div>
					<div class="px-4 flex flex-wrap gap-3">
						{#each theme.themes as t}
							<button
								onclick={() => theme.setTheme(t.id)}
								class="text-sm text-n-700 flex rounded-full hover:outline-n-400 hover:outline-2 items-center gap-2 {theme.current === t.id ? 'font-bold outline-a-600 outline-2' : ''}"
								title={t.label}
							>
								<span class="flex overflow-hidden rounded-full border border-n-200">
									<span class="block w-4 h-8" style="background:{t.neutral}"></span>
									<span class="block w-4 h-8" style="background:{t.accent}"></span>
								</span>
							</button>
						{/each}
					</div>
				</div>

				{#if !ui.isMobile}
					<div class="border-t border-n-200 mt-1 pt-4">
						<div class="px-4 text-sm mb-1 font-medium text-n-500">Reading pane</div>
						<button
							onclick={() => { if (ui.layoutMode !== 'two-column') { ui.toggleLayoutMode(); } }}
							class="w-full px-4 py-1.5 text-sm hover:bg-n-100 text-n-700 flex items-center justify-between gap-3"
						>
							<span class="flex items-center gap-2">
								<span class="size-4 flex items-center justify-center">
									{#if ui.layoutMode === 'two-column'}
										<Circle size={12} fill="currentColor" class="text-a-600" />
									{:else}
										<Circle size={12} class="text-n-400" />
									{/if}
								</span>
								No split
							</span>
							<img src="/previewpaneoff.png" alt="" class="w-18" />
						</button>
						<button
							onclick={() => {
								if (ui.layoutMode !== 'three-column') {
									ui.toggleLayoutMode();
									if (isArticleView) history.back();
								}
							}}
							class="w-full px-4 py-1.5 text-sm hover:bg-n-100 text-n-700 flex items-center justify-between gap-3"
						>
							<span class="flex items-center text-left gap-2">
								<span class="size-4 flex items-center justify-center">
									{#if ui.layoutMode === 'three-column'}
										<Circle size={12} fill="currentColor" class="text-a-600" />
									{:else}
										<Circle size={12} class="text-n-400" />
									{/if}
								</span>
								Right of feeds
							</span>
							<img src="/previewpaneright.png" alt="" class="w-18" />
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

<svelte:document onclick={settingsDropdownOpen ? handleClickOutside : undefined} />

<!-- Desktop sidebar -->
{#if !ui.isMobile}
	<aside
		class="h-screen border-r-2 border-r-n-200 bg-surface flex flex-col shrink-0 relative"
		style="width: {ui.sidebarWidth}px"
	>
		<div class="p-4 flex items-center justify-between">
			<h2 class="text-lg text-n-800 font-bold leading-none"><a href="/">Miniflux Reader</a></h2>
			<div class="flex items-center gap-1">
				<button
					onclick={() => showAddModal = true}
					class="text-n-700 p-2 rounded-full hover:bg-n-200 transition-colors"
					title="Add feed"
				>
					<Plus size={20} />
				</button>
				{@render settingsButton()}
			</div>
		</div>
		<div class="overflow-y-auto flex-1">
			<FeedTree />
		</div>
		{@render logoutButton()}
		<!-- Resize handle -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-10 hover:bg-a-400/30 transition-colors {resizing ? 'bg-a-400/30' : ''}"
			onmousedown={onResizeStart}
		></div>
	</aside>
{/if}

<!-- Mobile drawer overlay -->
{#if ui.isMobile && ui.sidebarOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-black/30 z-40"
		onclick={() => ui.toggleSidebar()}
		onkeydown={(e) => e.key === 'Escape' && ui.toggleSidebar()}
	></div>
	<aside class="fixed left-0 top-0 h-full w-72 bg-surface z-50 shadow-lg flex flex-col">
		<div class="p-3 border-b border-n-200 flex items-center justify-between">
			<h2 class="text-xl text-a-600 font-medium">Miniflux Reader</h2>
			<div class="flex items-center gap-2">
				<button
					onclick={() => showAddModal = true}
					class="text-n-700 hover:bg-n-200 p-2 rounded-full transition-colors"
					title="Add feed"
				>
					<Plus size={20} />
				</button>
				{@render settingsButton()}
			</div>
		</div>
		<div class="overflow-y-auto flex-1">
			<FeedTree />
		</div>
		{@render logoutButton()}
	</aside>
{/if}

{#if showAddModal}
	<FeedAddModal
		categories={feeds.getCategories()}
		onclose={() => showAddModal = false}
		onsave={(data) => feeds.createFeed(data)}
	/>
{/if}
