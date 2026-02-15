<script lang="ts">
	import { goto } from '$app/navigation';
	import { LogOut } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import FeedTree from './FeedTree.svelte';

	function handleLogout() {
		auth.logout();
		goto('/login');
	}
</script>

{#snippet logoutButton()}
	<div class="border-t border-gray-200 p-3 mt-auto">
		<button
			onclick={handleLogout}
			class="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors w-full cursor-pointer"
		>
			<LogOut size={16} />
			Logout
		</button>
	</div>
{/snippet}

<!-- Desktop sidebar -->
{#if !ui.isMobile}
	<aside class="w-64 h-screen border-r border-gray-200 bg-white flex flex-col shrink-0">
		<div class="p-3 border-b border-gray-200">
			<h2 class="font-bold text-lg">Feeds</h2>
		</div>
		<div class="overflow-y-auto flex-1">
			<FeedTree />
		</div>
		{@render logoutButton()}
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
		<div class="p-3 border-b border-gray-200">
			<h2 class="font-bold text-lg">Feeds</h2>
		</div>
		<div class="overflow-y-auto flex-1">
			<FeedTree />
		</div>
		{@render logoutButton()}
	</aside>
{/if}
