<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Menu, Circle, Square, SquareCheck, List, LayoutList, LayoutGrid, EllipsisVertical, Pencil, CheckCheck, Search, X, ExternalLink, Filter } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { resolveTheme } from '$lib/themes';
	import { makeFeedSlug } from '$lib/slug';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import CategoryEditModal from '$lib/components/ui/CategoryEditModal.svelte';

	const isArticleView = $derived(page.route.id?.includes('/article/') ?? false);
	const isSettingsView = $derived(page.route.id?.includes('/settings') ?? false);
	const isFullView = $derived(isArticleView || isSettingsView);
	const articleFeedNode = $derived(
		ui.selectedEntry?.feed ? feeds.findFeedNodeById(ui.selectedEntry.feed.id, true) : null
	);
	const selectedFeedNode = $derived(
		ui.selectedFeed?.isFeed ? ui.selectedFeed : null
	);
	const selectedFeedSiteUrl = $derived(
		selectedFeedNode ? (feeds.getRawFeed(selectedFeedNode.id)?.site_url || '') : ''
	);
	const backIcon = $derived(isArticleView ? articleFeedNode?.iconData : selectedFeedNode?.iconData);
	const backTitle = $derived(
		isArticleView ? (ui.selectedEntry?.feed?.title || 'Article') : (ui.selectedFeed?.title || 'Feed')
	);
	const backSiteUrl = $derived(
		isArticleView
			? (ui.selectedEntry?.feed ? feeds.getRawFeed(ui.selectedEntry.feed.id)?.site_url || '' : '')
			: selectedFeedSiteUrl
	);

	let viewDropdownOpen = $state(false);

	const viewModes = [
		{ id: 'list' as const, label: 'List view', icon: List },
		{ id: 'magazine' as const, label: 'Magazine view', icon: LayoutList },
		{ id: 'cards' as const, label: 'Cards view', icon: LayoutGrid },
	];

	const currentViewMode = $derived(viewModes.find(m => m.id === ui.viewMode)!);

	function selectViewMode(mode: 'list' | 'magazine' | 'cards') {
		ui.setViewMode(mode);
		viewDropdownOpen = false;
	}

	const layoutModes = [
		{ id: 'two-column' as const, label: 'No split', img: '/previewpaneoff.png' },
		{ id: 'three-column' as const, label: 'Right of feeds', img: '/previewpaneright.png' },
		{ id: 'expanded' as const, label: 'Expanded', img: '/previewpaneexpanded.png' },
	];

	function selectLayoutMode(mode: 'two-column' | 'three-column' | 'expanded') {
		viewDropdownOpen = false;
		if (ui.layoutMode === mode) return;
		ui.setLayoutMode(mode);
		if (mode !== 'two-column' && isArticleView) history.back();
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.view-mode-dropdown')) {
			viewDropdownOpen = false;
		}
	}

	let markingAllRead = $state(false);
	const hasUnread = $derived(entries.entries.some(e => e.status === 'unread'));

	async function markAllAsRead() {
		const feed = ui.selectedFeed;
		if (!feed) return;
		markingAllRead = true;
		try {
			await entries.markAllRead(feed);
		} finally {
			markingAllRead = false;
		}
	}

	let dotMenu = $state<{ x: number; y: number } | null>(null);
	let dotMenuBtn = $state<HTMLButtonElement | null>(null);
	let showCatEdit = $state(false);

	const showDotMenu = $derived(
		ui.selectedFeed && ui.selectedFeed.id !== -1 && ui.selectedFeed.id !== -2
	);

	function toggleDotMenu(e: MouseEvent) {
		if (dotMenu) {
			dotMenu = null;
			return;
		}
		const btn = e.currentTarget as HTMLElement;
		const rect = btn.getBoundingClientRect();
		dotMenu = { x: rect.right, y: rect.bottom + 4 };
	}

	function dotMenuItems() {
		const feed = ui.selectedFeed;
		if (!feed) return [];
		if (feed.isFeed) {
			return [
				...(feed.id > 0
					? [{ label: 'Filters', icon: Filter, action: () => { ui.openFiltersPanel(feed.id); } }]
					: []),
				{ label: 'Edit Feed', icon: Pencil, action: () => { goto(`/feed/${makeFeedSlug(feed.id, feed.title)}/settings`); } },
			];
		}
		return [
			{ label: 'Edit Category', icon: Pencil, action: () => { showCatEdit = true; } },
		];
	}

	// On mobile the field stays collapsed behind the icon; on desktop it is always visible.
	let searchOpen = $state(false);
	let searchInput = $state('');
	let searchInputEl = $state<HTMLInputElement | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const showSearchField = $derived(!ui.isMobile || searchOpen);

	function openSearch() {
		searchOpen = true;
		tick().then(() => searchInputEl?.focus());
	}

	function resetSearch() {
		searchInput = '';
		if (debounceTimer) clearTimeout(debounceTimer);
		entries.clearSearch();
	}

	function onClearClick() {
		resetSearch();
		if (ui.isMobile) {
			searchOpen = false;
		} else {
			searchInputEl?.focus();
		}
	}

	function onSearchInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			entries.setSearchQuery(searchInput);
		}, 300);
	}

	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (searchInput) {
				resetSearch();
			} else if (ui.isMobile) {
				searchOpen = false;
			} else {
				searchInputEl?.blur();
			}
		}
	}

	function onGlobalKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
			if (!ui.selectedFeed) return;
			e.preventDefault();
			if (showSearchField) {
				searchInputEl?.focus();
				searchInputEl?.select();
			} else {
				openSearch();
			}
		}
	}

	let prevFeedId: number | undefined;
	$effect(() => {
		const id = ui.selectedFeed?.id;
		if (prevFeedId !== undefined && id !== prevFeedId) {
			resetSearch();
			searchOpen = false;
		}
		prevFeedId = id;
	});
</script>

<svelte:document onclick={viewDropdownOpen ? handleClickOutside : undefined} onkeydown={onGlobalKeydown} />

<header class="h-12 border-b border-nb-200 bg-navbar text-nb-900 flex justify-between items-center pl-4 pr-2 lg:gap-3 shrink-0">
	{#if ui.isMobile}
		<button onclick={() => ui.toggleSidebar()} class="text-nb-600 hover:text-nb-900 mr-2.5">
			<Menu size={20} />
		</button>
	{/if}

	{#if isFullView}
		<div class="group flex items-center gap-3 flex-1 min-w-0">
			<button onclick={() => history.back()} class="max-w-fit hover:underline flex gap-3.5 items-center text-xl font-bold truncate min-w-0">
				{#if backIcon}
					<img src={backIcon} alt="" class="size-5.5 mt-1 shrink-0" />
				{/if}
				<span class="truncate">{backTitle}</span>
			</button>
			{#if backSiteUrl}
				<a
					href={backSiteUrl}
					target="_blank"
					rel="noopener noreferrer"
					title="Open site"
					class="shrink-0 mt-1 text-nb-500 hover:text-nb-800 opacity-0 group-hover:opacity-100 transition-opacity"
				>
					<ExternalLink size={18} />
				</a>
			{/if}
		</div>
	{:else}
		{#if !(ui.isMobile && searchOpen)}
			<div class="group text-xl font-bold flex-1 min-w-5.5 flex gap-3.5 items-center">
				{#if selectedFeedNode?.iconData}
					<img src={selectedFeedNode.iconData} alt="" class="size-5.5 shrink-0 mt-1" />
				{/if}
				<span class="truncate">{ui.selectedFeed?.title || 'Miniflux Reader'}</span>
				{#if selectedFeedSiteUrl}
					<a
						href={selectedFeedSiteUrl}
						target="_blank"
						rel="noopener noreferrer"
						title="Open site"
						class="shrink-0 mt-1 text-nb-500 hover:text-nb-800 opacity-0 group-hover:opacity-100 transition-opacity"
					>
						<ExternalLink size={18} />
					</a>
				{/if}
			</div>
		{/if}

		{#if ui.selectedFeed}
			{#if showSearchField}
				<div class="relative min-w-0 {ui.isMobile ? 'flex-1' : 'w-32 lg:w-48 xl:w-64'}">
					<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-nb-500 pointer-events-none" />
					<input
						bind:this={searchInputEl}
						bind:value={searchInput}
						oninput={onSearchInput}
						onkeydown={onSearchKeydown}
						type="text"
						placeholder="Search"
						title="Search (Ctrl+K)"
						class="w-full outline-none text-sm text-nb-900 placeholder:text-nb-500 bg-transparent border border-nb-300 rounded-full pl-9 pr-8 py-1.5 focus:border-nb-500"
					/>
					{#if searchInput || ui.isMobile}
						<button
							onclick={onClearClick}
							class="absolute right-1.5 top-1/2 -translate-y-1/2 text-nb-600 hover:text-nb-900 p-1 rounded-full hover:bg-nb-200"
							title="Clear search"
						>
							<X size={14} />
						</button>
					{/if}
				</div>
			{:else}
				<button
					onclick={openSearch}
					title="Search (Ctrl+K)"
					class="text-nb-700 hover:bg-nb-200 p-2 rounded-full"
				>
					<Search size={20} />
				</button>
			{/if}
			<button
				onclick={markAllAsRead}
				disabled={markingAllRead || !hasUnread}
				title="Mark all as read"
				class="text-nb-700 hover:bg-nb-200 p-2 rounded-full disabled:opacity-50"
			>
				<CheckCheck size={20} />
			</button>
			<div class="display-buttons flex items-center lg:gap-1 relative">
				<button
					onclick={() => entries.toggleShowAll()}
					title={entries.showAll ? 'Show unread only' : 'Show all'}
					class="text-nb-700 hover:bg-nb-200 p-2 rounded-full transition-colors"
				>
					<Circle size={20} fill={entries.showAll ? 'none' : 'currentColor'} />
				</button>
					<div class="relative view-mode-dropdown">
					<button
						onclick={() => viewDropdownOpen = !viewDropdownOpen}
						title={currentViewMode.label}
						class="text-nb-700 hover:bg-nb-200 p-2 rounded-full"
					>
						<currentViewMode.icon size={24} />
					</button>
					{#if viewDropdownOpen}
						<div class="absolute -right-3 top-full mt-1 bg-surface border border-n-200 rounded-md shadow-lg py-2 z-50 min-w-56">
							<div class="px-4 text-sm mb-1 font-medium text-n-500">View</div>
							{#each viewModes as mode (mode.id)}
								<button
									onclick={() => selectViewMode(mode.id)}
									title={mode.label}
									class="w-full text-left px-4 py-2 text-sm flex items-center gap-2 {ui.viewMode === mode.id ? 'bg-a-50 text-a-700 font-medium' : 'text-n-700 hover:bg-n-100'}"
								>
									<mode.icon size={18} class="shrink-0" />
									{mode.label}
								</button>
							{/each}

							{#if !ui.isMobile}
								<div class="border-t border-n-200 mt-1 pt-4">
									<div class="px-4 text-sm mb-1 font-medium text-n-500">Reading pane</div>
									{#each layoutModes as mode (mode.id)}
										<button
											onclick={() => selectLayoutMode(mode.id)}
											class="w-full px-4 py-1.5 text-sm hover:bg-n-100 text-n-700 flex items-center justify-between gap-3"
										>
											<span class="flex items-center text-left gap-2">
												<span class="size-4 flex items-center justify-center">
													{#if ui.layoutMode === mode.id}
														<Circle size={12} fill="currentColor" class="text-a-600" />
													{:else}
														<Circle size={12} class="text-n-400" />
													{/if}
												</span>
												{mode.label}
											</span>
											<img src={mode.img} alt="" class="w-18" />
										</button>
									{/each}
									<!-- A checkbox, not a fourth placement radio: Zen layers on top of whichever
									     pane mode is selected and hands it back when switched off. -->
									<button
										onclick={() => ui.toggleZenMode()}
										title="Open articles full-window, without the sidebar"
										class="w-full text-left px-4 py-2 mt-1 text-sm hover:bg-n-100 text-n-700 flex items-center gap-2"
									>
										{#if ui.zenMode}
											<SquareCheck size={18} class="shrink-0 text-a-600" />
										{:else}
											<Square size={18} class="shrink-0 text-n-500" />
										{/if}
										Zen mode
									</button>
								</div>
							{/if}

							<button
								onclick={() => ui.toggleAutoMarkRead()}
								class="w-full text-left px-4 py-2.5 text-sm hover:bg-n-100 flex items-center gap-2 border-t border-n-200 mt-1"
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
									{#each theme.all as t (t.id)}
										{@const swatch = resolveTheme(t)}
										<button
											onclick={() => theme.setTheme(t.id)}
											class="text-sm text-n-700 flex rounded-full hover:outline-n-400 hover:outline-2 items-center gap-2 {theme.current === t.id ? 'font-bold outline-a-600 outline-2' : ''}"
											title={t.label}
										>
											<span class="flex overflow-hidden rounded-full border border-n-200">
												<span class="block w-4 h-8" style="background:{swatch['n-200']}"></span>
												<span class="block w-4 h-8" style="background:{swatch['a-600']}"></span>
											</span>
										</button>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if showDotMenu}
			<button
				bind:this={dotMenuBtn}
				onclick={toggleDotMenu}
				class="text-nb-700 hover:bg-nb-200 p-2 rounded-full shrink-0"
				title="Menu"
			>
				<EllipsisVertical size={20} />
			</button>
		{/if}
	{/if}


</header>

{#if dotMenu}
	<ContextMenu
		x={dotMenu.x}
		y={dotMenu.y}
		items={dotMenuItems()}
		anchor={dotMenuBtn}
		onclose={() => { dotMenu = null; }}
	/>
{/if}

{#if showCatEdit && ui.selectedFeed && !ui.selectedFeed.isFeed}
	<CategoryEditModal
		title={ui.selectedFeed.title}
		onclose={() => { showCatEdit = false; }}
		onsave={(title) => feeds.updateCategory(ui.selectedFeed!.id, title)}
	/>
{/if}

<style>
  @reference "../../../app.css";
  .display-buttons {
    @apply md:ml-4;
    &::before {
      @apply content-[''] hidden md:block absolute left-[-13px] top-[12px] w-0.5 h-[16px] bg-nb-200;
    }
  }

</style>
