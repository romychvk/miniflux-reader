<script lang="ts">
	import { goto } from '$app/navigation';
	import { LogOut, Plus } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import FeedTree from './FeedTree.svelte';
	import FeedAddModal from '$lib/components/ui/FeedAddModal.svelte';

	let showAddModal = $state(false);

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
	<div class="border-t border-slate-200 p-3 mt-auto">
		<button
			onclick={handleLogout}
			class="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors w-full cursor-pointer"
		>
			<LogOut size={16} />
			Logout
		</button>
	</div>
{/snippet}

<!-- Desktop sidebar -->
{#if !ui.isMobile}
	<aside
		class="h-screen border-r border-slate-200 bg-white flex flex-col shrink-0 relative"
		style="width: {ui.sidebarWidth}px"
	>
		<div class="p-3 border-b border-slate-200 bg-slate-200 flex items-center justify-between">
			<h2 class="text-lg text-p font-medium leading-none">Miniflux Reader</h2>
			<button
				onclick={() => showAddModal = true}
				class="text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
				title="Add feed"
			>
				<Plus size={20} />
			</button>
		</div>
		<div class="overflow-y-auto flex-1">
			<FeedTree />
		</div>
		{@render logoutButton()}
		<!-- Resize handle -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-10 hover:bg-blue-400/30 transition-colors {resizing ? 'bg-blue-400/30' : ''}"
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
	<aside class="fixed left-0 top-0 h-full w-72 bg-white z-50 shadow-lg flex flex-col">
		<div class="p-3 border-b border-slate-200 flex items-center justify-between">
			<h2 class="text-xl text-orange-600 font-medium">Miniflux Reader</h2>
			<button
				onclick={() => showAddModal = true}
				class="text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
				title="Add feed"
			>
				<Plus size={20} />
			</button>
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
