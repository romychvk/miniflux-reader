<script lang="ts">
	import { Menu } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';
</script>

<header class="h-12 border-b border-gray-200 bg-white flex items-center px-3 gap-3 shrink-0">
	{#if ui.isMobile}
		<button onclick={() => ui.toggleSidebar()} class="text-gray-600 hover:text-gray-900">
			<Menu size={20} />
		</button>
	{/if}

	<h1 class="text-sm font-semibold truncate flex-1">
		{ui.selectedFeed?.title || 'Miniflux Reader'}
	</h1>
</header>
