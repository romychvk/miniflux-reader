<script lang="ts">
	import { page } from '$app/state';
	import { Menu, Circle, Columns2, Columns3 } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';

	const isArticleView = $derived(page.route.id?.includes('/article/') ?? false);
	const articleFeedNode = $derived(
		ui.selectedEntry?.feed ? feeds.findFeedNodeById(ui.selectedEntry.feed.id, true) : null
	);
	const selectedFeedNode = $derived(
		ui.selectedFeed?.isFeed ? ui.selectedFeed : null
	);
</script>

<header class="h-12 border-b border-gray-200 bg-white flex items-center px-4 gap-3 shrink-0">
	{#if isArticleView}
    <button onclick={() => history.back()} class="hover:underline flex gap-3 items-center text-lg font-bold truncate">
      {#if articleFeedNode?.iconData}
        <img src={articleFeedNode.iconData} alt="" class="size-5 shrink-0" />
      {/if}
      {ui.selectedEntry?.feed?.title || 'Article'}
    </button>
	{:else}
		{#if ui.isMobile}
			<button onclick={() => ui.toggleSidebar()} class="text-gray-600 hover:text-gray-900">
				<Menu size={20} />
			</button>
		{/if}

		<div class="text-lg font-bold truncate flex-1 flex gap-3 items-center">
			{#if selectedFeedNode?.iconData}
				<img src={selectedFeedNode.iconData} alt="" class="size-5 shrink-0" />
			{/if}
			{ui.selectedFeed?.title || 'Miniflux Reader'}
		</div>

		{#if ui.selectedFeed}
			{#if !ui.isMobile}
				<button
					onclick={() => ui.toggleLayoutMode()}
					title={ui.layoutMode === 'two-column' ? 'Switch to 3-column layout' : 'Switch to 2-column layout'}
					class="text-gray-400 hover:text-gray-600"
				>
					{#if ui.layoutMode === 'two-column'}
						<Columns2 size={20} />
					{:else}
						<Columns3 size={20} />
					{/if}
				</button>
			{/if}
			<button
				onclick={() => entries.toggleShowAll()}
				title={entries.showAll ? 'Show unread only' : 'Show all'}
				class="text-gray-400 hover:text-gray-600"
			>
				<Circle size={20} fill={entries.showAll ? 'none' : 'currentColor'} />
			</button>
		{/if}
	{/if}
</header>
