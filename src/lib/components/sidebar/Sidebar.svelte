<script lang="ts">
	import { ui } from '$lib/stores/ui.svelte';
	import FeedTree from './FeedTree.svelte';
</script>

<!-- Desktop sidebar -->
{#if !ui.isMobile}
	<aside class="w-64 h-screen border-r border-gray-200 bg-white overflow-y-auto shrink-0">
		<div class="p-3 border-b border-gray-200">
			<h2 class="font-bold text-lg">Feeds</h2>
		</div>
		<FeedTree />
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
	<aside class="fixed left-0 top-0 h-full w-72 bg-white z-50 shadow-lg overflow-y-auto">
		<div class="p-3 border-b border-gray-200">
			<h2 class="font-bold text-lg">Feeds</h2>
		</div>
		<FeedTree />
	</aside>
{/if}
