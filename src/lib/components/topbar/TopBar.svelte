<script lang="ts">
	import { page } from '$app/state';
	import { Menu, Circle, Columns2, Columns3, List, LayoutList, LayoutGrid, EllipsisVertical, Pencil, RefreshCw } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import FeedEditModal from '$lib/components/ui/FeedEditModal.svelte';
	import CategoryEditModal from '$lib/components/ui/CategoryEditModal.svelte';

	const isArticleView = $derived(page.route.id?.includes('/article/') ?? false);
	const articleFeedNode = $derived(
		ui.selectedEntry?.feed ? feeds.findFeedNodeById(ui.selectedEntry.feed.id, true) : null
	);
	const selectedFeedNode = $derived(
		ui.selectedFeed?.isFeed ? ui.selectedFeed : null
	);

	let viewDropdownOpen = $state(false);

	const viewModes = [
		{ id: 'list' as const, label: 'List view', icon: List },
		{ id: 'magazine' as const, label: 'Magazine view', icon: LayoutList },
		{ id: 'cards' as const, label: 'Cards view', icon: LayoutGrid },
	];

	const currentViewMode = $derived(viewModes.find(m => m.id === ui.viewMode)!);
	const otherViewModes = $derived(viewModes.filter(m => m.id !== ui.viewMode));

	function selectViewMode(mode: 'list' | 'magazine' | 'cards') {
		ui.setViewMode(mode);
		viewDropdownOpen = false;
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.view-mode-dropdown')) {
			viewDropdownOpen = false;
		}
	}

	let dotMenu = $state<{ x: number; y: number } | null>(null);
	let showFeedEdit = $state(false);
	let showCatEdit = $state(false);

	const showDotMenu = $derived(
		ui.selectedFeed && ui.selectedFeed.id !== -1
	);

	function openDotMenu(e: MouseEvent) {
		const btn = e.currentTarget as HTMLElement;
		const rect = btn.getBoundingClientRect();
		dotMenu = { x: rect.right, y: rect.bottom + 4 };
	}

	function dotMenuItems() {
		const feed = ui.selectedFeed;
		if (!feed) return [];
		if (feed.isFeed) {
			return [
				{ label: 'Edit Feed', icon: Pencil, action: () => { showFeedEdit = true; } },
				{ label: 'Refresh Feed', icon: RefreshCw, action: async () => {
					try {
						await feeds.refreshFeed(feed.id);
						if (ui.selectedFeed) entries.loadEntries(ui.selectedFeed.apiPath);
					} catch { /* already handled */ }
				}}
			];
		}
		return [
			{ label: 'Edit Category', icon: Pencil, action: () => { showCatEdit = true; } },
			{ label: 'Refresh Feeds', icon: RefreshCw, action: async () => {
				await feeds.refreshCategoryFeeds(feed.id);
				if (ui.selectedFeed) entries.loadEntries(ui.selectedFeed.apiPath);
			}}
		];
	}
</script>

<svelte:document onclick={viewDropdownOpen ? handleClickOutside : undefined} />

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

		<div class="text-2xl font-bold truncate flex-1 flex gap-3 items-center">
			{#if selectedFeedNode?.iconData}
				<img src={selectedFeedNode.iconData} alt="" class="size-5 shrink-0" />
			{/if}
			{ui.selectedFeed?.title || 'Miniflux Reader'}
		</div>

		{#if showDotMenu}
			<button
				onclick={openDotMenu}
				class="text-slate-400 hover:text-slate-600 shrink-0"
				title="Menu"
			>
				<EllipsisVertical size={20} />
			</button>
		{/if}

		{#if ui.selectedFeed}
      <div class="flex items-center border-l border-slate-300 pl-3 gap-3.5">
        <button
          onclick={() => entries.toggleShowAll()}
          title={entries.showAll ? 'Show unread only' : 'Show all'}
          class="text-slate-400 hover:text-slate-600"
        >
          <Circle size={20} fill={entries.showAll ? 'none' : 'currentColor'} />
        </button>
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
				<div class="relative view-mode-dropdown">
					<button
						onclick={() => viewDropdownOpen = !viewDropdownOpen}
						title={currentViewMode.label}
						class="flex items-center gap-0.5 text-slate-400 hover:text-slate-600"
					>
						<currentViewMode.icon size={24} />
					</button>
					{#if viewDropdownOpen}
						<div class="absolute -right-3 top-full mt-1 bg-white border border-slate-200 rounded-md shadow-md py-1 z-50">
							{#each otherViewModes as mode}
								<button
									onclick={() => selectViewMode(mode.id)}
									title={mode.label}
									class="flex items-center px-3 py-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
								>
									<mode.icon size={24} />
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			
			
		{/if}
	{/if}
</header>

{#if dotMenu}
	<ContextMenu
		x={dotMenu.x}
		y={dotMenu.y}
		items={dotMenuItems()}
		onclose={() => { dotMenu = null; }}
	/>
{/if}

{#if showFeedEdit && ui.selectedFeed?.isFeed}
	{@const rawFeed = feeds.getRawFeed(ui.selectedFeed.id)}
	{#if rawFeed}
		<FeedEditModal
			feed={rawFeed}
			categories={feeds.getCategories()}
			onclose={() => { showFeedEdit = false; }}
			onsave={(changes) => feeds.updateFeed(ui.selectedFeed!.id, changes)}
		/>
	{/if}
{/if}

{#if showCatEdit && ui.selectedFeed && !ui.selectedFeed.isFeed}
	<CategoryEditModal
		title={ui.selectedFeed.title}
		onclose={() => { showCatEdit = false; }}
		onsave={(title) => feeds.updateCategory(ui.selectedFeed!.id, title)}
	/>
{/if}
