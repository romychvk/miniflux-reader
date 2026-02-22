<script lang="ts">
	import { page } from '$app/state';
	import { Menu, Circle, List, LayoutList, LayoutGrid, EllipsisVertical, Pencil, RefreshCw, Settings, Square, SquareCheck } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { theme } from '$lib/stores/theme.svelte';
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
	let settingsDropdownOpen = $state(false);
	let refreshing = $state(false);
	let refreshResult = $state('');
	let refreshResultTimeout: ReturnType<typeof setTimeout> | null = null;

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
		if (!target.closest('.settings-dropdown')) {
			settingsDropdownOpen = false;
		}
	}

	async function refreshCurrentFeed() {
		const feed = ui.selectedFeed;
		if (!feed) return;
		refreshing = true;
		const countBefore = entries.entries.length;
		try {
			if (feed.isFeed) {
				await feeds.refreshFeed(feed.id);
			} else if (feed.id === -1) {
				await feeds.refreshAllFeeds();
			} else {
				await feeds.refreshCategoryFeeds(feed.id);
			}
			await entries.loadEntries(feed.apiPath);
			const newCount = entries.entries.length - countBefore;
			if (newCount > 0) {
				refreshResult = `+${newCount} new`;
			} else {
				refreshResult = 'No new';
			}
			if (refreshResultTimeout) clearTimeout(refreshResultTimeout);
			refreshResultTimeout = setTimeout(() => { refreshResult = ''; }, 3000);
		} catch {
			/* errors already handled by store methods */
		} finally {
			refreshing = false;
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
			];
		}
		return [
			{ label: 'Edit Category', icon: Pencil, action: () => { showCatEdit = true; } },
		];
	}
</script>

<svelte:document onclick={(viewDropdownOpen || settingsDropdownOpen) ? handleClickOutside : undefined} />

<header class="h-12 border-b border-n-200 bg-surface flex justify-between items-center px-4 gap-3 shrink-0">
	{#if ui.isMobile}
		<button onclick={() => ui.toggleSidebar()} class="text-n-600 hover:text-n-900">
			<Menu size={20} />
		</button>
	{/if}

	{#if isArticleView}
		<button onclick={() => history.back()} class="max-w-fit hover:underline flex gap-3 items-center text-2xl font-bold truncate flex-1 min-w-0">
			{#if articleFeedNode?.iconData}
				<img src={articleFeedNode.iconData} alt="" class="size-5 shrink-0" />
			{/if}
			{ui.selectedEntry?.feed?.title || 'Article'}
		</button>
	{:else}
		<div class="text-2xl font-bold truncate flex-1 flex gap-3 items-center">
			{#if selectedFeedNode?.iconData}
				<img src={selectedFeedNode.iconData} alt="" class="size-5 shrink-0" />
			{/if}
			{ui.selectedFeed?.title || 'Miniflux Reader'}
		</div>

		{#if ui.selectedFeed}
			{#if refreshResult}
				<span class="text-xs text-a-600 whitespace-nowrap">{refreshResult}</span>
			{/if}
			<button
				onclick={refreshCurrentFeed}
				disabled={refreshing}
				title={ui.selectedFeed.isFeed ? 'Refresh Feed' : 'Refresh Feeds'}
				class="text-n-400 hover:text-n-600 disabled:opacity-50"
			>
				<RefreshCw size={18} class={refreshing ? 'animate-spin' : ''} />
			</button>
			<div class="flex items-center border-l border-n-300 px-3 gap-3.5">
				<button
					onclick={() => entries.toggleShowAll()}
					title={entries.showAll ? 'Show unread only' : 'Show all'}
					class="text-n-400 hover:text-n-600"
				>
					<Circle size={20} fill={entries.showAll ? 'none' : 'currentColor'} />
				</button>
					<div class="relative view-mode-dropdown">
					<button
						onclick={() => viewDropdownOpen = !viewDropdownOpen}
						title={currentViewMode.label}
						class="flex items-center gap-0.5 text-n-400 hover:text-n-600"
					>
						<currentViewMode.icon size={24} />
					</button>
					{#if viewDropdownOpen}
						<div class="absolute -right-3 top-full mt-1 bg-surface border border-n-200 rounded-md shadow-md py-1 z-50">
							{#each otherViewModes as mode}
								<button
									onclick={() => selectViewMode(mode.id)}
									title={mode.label}
									class="flex items-center px-3 py-1.5 text-n-400 hover:text-n-600 hover:bg-n-50"
								>
									<mode.icon size={24} />
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if showDotMenu}
			<button
				onclick={openDotMenu}
				class="text-n-400 hover:text-n-600 shrink-0"
				title="Menu"
			>
				<EllipsisVertical size={20} />
			</button>
		{/if}
	{/if}

	<!-- Settings gear -->
	<div class="relative settings-dropdown flex items-center">
		<button
			onclick={() => settingsDropdownOpen = !settingsDropdownOpen}
			title="Settings"
			class="text-n-600 hover:bg-n-100 p-2 rounded-full"
		>
			<Settings size={20} />
		</button>
		{#if settingsDropdownOpen}
			<div class="absolute right-0 top-full mt-1 bg-surface border border-n-200 rounded-md shadow-md py-1 z-50 min-w-52">
				<button
					onclick={() => ui.toggleAutoMarkRead()}
					class="w-full text-left px-3 py-2.5 text-sm hover:bg-n-100 flex items-center gap-2"
				>
					{#if ui.autoMarkReadOnScroll}
						<SquareCheck size={18} class="shrink-0 text-a-600" />
					{:else}
						<Square size={18} class="shrink-0 text-n-500" />
					{/if}
					Mark read on scroll
				</button>

				<div class="border-t border-n-200 mt-1 py-4">
					<div class="px-3 text-sm mb-3 font-medium text-n-500">Theme</div>
          <div class="px-3 flex flex-wrap gap-3">
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
                <!-- {t.label} -->
              </button>
            {/each}
          </div>
				</div>

				{#if !ui.isMobile}
					<div class="border-t border-n-200 mt-1 pt-4">
						<div class="px-3 text-sm mb-2 font-medium text-n-500">Reading pane</div>
						<button
							onclick={() => { if (ui.layoutMode !== 'two-column') { ui.toggleLayoutMode(); } }}
							class="w-full text-left px-3 py-1.5 text-sm hover:bg-n-100 text-n-700 flex items-center justify-between gap-3"
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
							class="w-full text-left px-3 py-1.5 text-sm hover:bg-n-100 text-n-700 flex items-center justify-between gap-3"
						>
							<span class="flex items-center gap-2">
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
