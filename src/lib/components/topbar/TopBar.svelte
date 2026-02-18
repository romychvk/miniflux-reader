<script lang="ts">
	import { page } from '$app/state';
	import { Menu, Circle, Columns2, Columns3, List, LayoutList, LayoutGrid } from 'lucide-svelte';
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

<header class="h-12 border-b border-slate-200 bg-white flex items-center px-4 gap-3 shrink-0">
	{#if isArticleView}
    <button onclick={() => history.back()} class="hover:underline flex gap-3 items-center text-lg font-bold truncate">
      {#if articleFeedNode?.iconData}
        <img src={articleFeedNode.iconData} alt="" class="size-5 shrink-0" />
      {/if}
      {ui.selectedEntry?.feed?.title || 'Article'}
    </button>
	{:else}
		{#if ui.isMobile}
			<button onclick={() => ui.toggleSidebar()} class="text-slate-600 hover:text-slate-900">
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
    <button
				onclick={() => entries.toggleShowAll()}
				title={entries.showAll ? 'Show unread only' : 'Show all'}
				class="text-slate-400 hover:text-slate-600"
			>
				<Circle size={20} fill={entries.showAll ? 'none' : 'currentColor'} />
			</button>
			<div class="flex items-center border-l border-slate-300 overflow-hidden pl-3 gap-2">
        {#if !ui.isMobile}
          <button
            onclick={() => ui.toggleLayoutMode()}
            title={ui.layoutMode === 'two-column' ? 'Switch to 3-column layout' : 'Switch to 2-column layout'}
            class="text-slate-400 hover:text-slate-600"
          >
            {#if ui.layoutMode === 'two-column'}
              <Columns2 size={24} />
            {:else}
              <Columns3 size={24} />
            {/if}
          </button>
        {/if}
				<button
					onclick={() => ui.setViewMode('list')}
					title="List view"
					class=" {ui.viewMode === 'list' ? 'bg-slate-100 text-p-dark' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}"
				>
					<List size={24} />
				</button>
				<button
					onclick={() => ui.setViewMode('magazine')}
					title="Magazine view"
					class=" {ui.viewMode === 'magazine' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}"
				>
					<LayoutList size={24} />
				</button>
				<button
					onclick={() => ui.setViewMode('cards')}
					title="Cards view"
					class=" {ui.viewMode === 'cards' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}"
				>
					<LayoutGrid size={24} />
				</button>
			</div>

			
			
		{/if}
	{/if}
</header>
