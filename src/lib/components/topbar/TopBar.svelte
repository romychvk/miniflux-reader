<script lang="ts">
	import { page } from '$app/state';
	import { Menu, Circle, ArrowLeft } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { entries } from '$lib/stores/entries.svelte';

	const isArticleView = $derived(page.route.id?.includes('/article/') ?? false);
</script>

<header class="h-12 border-b border-gray-200 bg-white flex items-center px-3 gap-3 shrink-0">
	{#if isArticleView}
		<button onclick={() => history.back()} class="text-gray-600 hover:text-gray-900">
			<ArrowLeft size={20} />
		</button>
		<h1 class="text-sm font-semibold truncate flex-1">
			{ui.selectedEntry?.feed?.title || 'Article'}
		</h1>
	{:else}
		{#if ui.isMobile}
			<button onclick={() => ui.toggleSidebar()} class="text-gray-600 hover:text-gray-900">
				<Menu size={20} />
			</button>
		{/if}

		<h1 class="text-sm font-semibold truncate flex-1">
			{ui.selectedFeed?.title || 'Miniflux Reader'}
		</h1>

		{#if ui.selectedFeed}
			<button
				onclick={() => entries.toggleShowAll()}
				title={entries.showAll ? 'Show unread only' : 'Show all'}
				class="text-gray-400 hover:text-gray-600"
			>
				<Circle size={16} fill={entries.showAll ? 'none' : 'currentColor'} />
			</button>
		{/if}
	{/if}
</header>
