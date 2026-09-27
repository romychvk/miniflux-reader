<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Menu, Circle, Check, ChevronDown, List, LayoutList, LayoutGrid, EllipsisVertical, Pencil, CheckCheck, RotateCw, Search, X, ExternalLink, Filter } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import type { LayoutMode } from '$lib/layoutMode';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { refresh } from '$lib/stores/refresh.svelte';
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

	const unreadCount = $derived(ui.selectedFeed?.unread ?? 0);

	let viewDropdownOpen = $state(false);

	// Shared pieces of the view dropdown's look.
	const sectionLabel = 'px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-n-500';
	const menuItem = 'w-full px-2.5 rounded-lg flex items-center gap-2.5 text-[13.5px] text-left transition-colors';
	const menuDivider = 'h-px bg-n-200/70 mx-1 my-2';

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
		{ id: 'three-column' as const, label: 'Right of feeds', img: '/previewpaneright.png' },
		{ id: 'expanded' as const, label: 'Expanded', img: '/previewpaneexpanded.png' },
		{ id: 'two-column' as const, label: 'No split', img: '/previewpaneoff.png' },
		{ id: 'zen' as const, label: 'Zen', img: '/previewpanezen.png' },
	];

	function selectLayoutMode(mode: LayoutMode) {
		viewDropdownOpen = false;
		if (ui.layoutMode === mode) return;
		ui.setLayoutMode(mode);
		// Switching to a split pane while reading pops back to the list, where that pane is what
		// shows the article. Full-page placements (two-column, zen) are already correct — stay put.
		// NOTE: dead today, the top bar isn't rendered on the article route; kept honest.
		if (mode !== 'two-column' && mode !== 'zen' && isArticleView) history.back();
	}

	// composedPath() is fixed at dispatch, so a click still counts as inside even when the clicked
	// node has been re-rendered out of the DOM by the time this runs (target.closest() would miss).
	function handleClickOutside(e: MouseEvent) {
		const inside = e
			.composedPath()
			.some((n) => n instanceof HTMLElement && n.classList.contains('view-mode-dropdown'));
		if (!inside) viewDropdownOpen = false;
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
		dotMenu = { x: rect.right, y: rect.bottom + 6 };
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
	let searchFocused = $state(false);
	// Desktop: the field sits narrow and widens while in use — focused, or still holding a query.
	const searchWide = $derived(searchFocused || !!searchInput);
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

<header class="h-13 border-b border-nb-200 bg-navbar text-nb-900 flex items-center pl-4 md:pl-5 pr-2 md:pr-3 gap-2 md:gap-2.5 shrink-0">
	{#if ui.isMobile}
		<button onclick={() => ui.toggleSidebar()} class="text-nb-600 hover:text-nb-900 mr-0.5">
			<Menu size={20} />
		</button>
	{/if}

	{#if isFullView}
		<div class="group flex items-center gap-3 flex-1 min-w-0">
			<button onclick={() => history.back()} class="max-w-fit hover:underline flex gap-3 items-center text-lg font-bold tracking-[-0.01em] truncate min-w-0">
				{#if backIcon}
					<img src={backIcon} alt="" class="size-5 rounded-[4px] shrink-0" />
				{/if}
				<span class="truncate">{backTitle}</span>
			</button>
			{#if backSiteUrl}
				<a
					href={backSiteUrl}
					target="_blank"
					rel="noopener noreferrer"
					title="Open site"
					class="shrink-0 text-nb-500 hover:text-nb-800 opacity-0 group-hover:opacity-100 transition-opacity"
				>
					<ExternalLink size={16} />
				</a>
			{/if}
		</div>
	{:else}
		{#if !(ui.isMobile && searchOpen)}
			<div class="group flex-1 min-w-5.5 flex gap-2.5 items-center">
				<span class="flex gap-3 items-center min-w-0 text-lg font-bold tracking-[-0.01em]">
					{#if selectedFeedNode?.iconData}
						<img src={selectedFeedNode.iconData} alt="" class="size-5 rounded-[4px] shrink-0" />
					{/if}
					<span class="truncate">{ui.selectedFeed?.title || 'Miniflux Reader'}</span>
				</span>
				{#if unreadCount > 0 && !ui.isMobile}
					<span class="shrink-0 pt-1 text-xs text-nb-500 tabular-nums">{unreadCount} unread</span>
				{/if}
				{#if selectedFeedSiteUrl}
					<a
						href={selectedFeedSiteUrl}
						target="_blank"
						rel="noopener noreferrer"
						title="Open site"
						class="shrink-0 text-nb-500 hover:text-nb-800 opacity-0 group-hover:opacity-100 transition-opacity"
					>
						<ExternalLink size={16} />
					</a>
				{/if}
			</div>
		{/if}

		{#if ui.selectedFeed}
			{#if showSearchField}
				<!-- Narrow at rest; widens while focused or holding a query. -->
				<div
					class="relative min-w-0 {ui.isMobile
						? 'flex-1'
						: searchWide
							? 'w-70'
							: 'w-44'} transition-[width] duration-160 ease-out motion-reduce:transition-none"
				>
					<Search
						size={15}
						class="absolute left-2.75 top-1/2 -translate-y-1/2 pointer-events-none transition-colors {searchFocused ? 'text-a-600' : 'text-nb-400'}"
					/>
					<input
						bind:this={searchInputEl}
						bind:value={searchInput}
						oninput={onSearchInput}
						onkeydown={onSearchKeydown}
						onfocus={() => (searchFocused = true)}
						onblur={() => (searchFocused = false)}
						type="text"
						placeholder="Search"
						title="Search (Ctrl+K)"
						class="w-full h-8.5 outline-none text-[13px] text-nb-900 placeholder:text-nb-500 rounded-full pl-8 {searchInput ? 'pr-16' : 'pr-3'} transition-[background-color,box-shadow] {searchFocused
							? 'bg-navbar shadow-[0_0_0_1.5px_var(--color-a-600),0_0_0_5px_color-mix(in_oklab,var(--color-a-600)_14%,transparent)]'
							: 'bg-nb-200/60'}"
					/>
					{#if searchInput && entries.searchQuery && !entries.loading}
						<span class="absolute right-9 top-1/2 -translate-y-1/2 text-[11px] text-nb-500 tabular-nums pointer-events-none">
							{entries.entries.length}
						</span>
					{/if}
					{#if searchInput || ui.isMobile}
						<button
							onclick={onClearClick}
							class="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center size-5.5 rounded-full bg-nb-200/60 text-nb-700 hover:bg-nb-200 hover:text-nb-900"
							title="Clear search"
						>
							<X size={12} />
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

			<!-- Content actions: they act on what the list shows. -->
			<div class="group md:ml-1.5 h-8.5 shrink-0 flex items-center rounded-full bg-a-50 text-a-700 overflow-hidden">
				<button
					onclick={() => { void refresh.refreshCurrent(); }}
					disabled={refresh.refreshing}
					title={ui.selectedFeed.isFeed ? 'Refresh feed' : 'Refresh feeds'}
					aria-label={ui.selectedFeed.isFeed ? 'Refresh feed' : 'Refresh feeds'}
					class="h-full pl-3.25 pr-2.5 grid place-items-center transition-colors hover:bg-a-600/12 active:bg-a-600 active:text-on-accent disabled:opacity-50 disabled:pointer-events-none"
				>
					<RotateCw size={16} class={refresh.refreshing ? 'animate-spin' : ''} />
				</button>
				<span class="w-px h-4.5 bg-a-600/20 transition-colors group-hover:bg-transparent"></span>
				<button
					onclick={markAllAsRead}
					disabled={markingAllRead || !hasUnread}
					title="Mark all as read"
					aria-label="Mark all as read"
					class="h-full pl-2.75 pr-3.5 flex items-center gap-1.75 text-[13px] font-semibold transition-colors hover:bg-a-600/12 active:bg-a-600 active:text-on-accent disabled:opacity-50 disabled:pointer-events-none"
				>
					<CheckCheck size={16} strokeWidth={2.2} />
					<span class="hidden lg:inline">Mark all as read</span>
				</button>
			</div>

			<!-- View controls: what the list shows and how. -->
			<div class="md:ml-1.5 shrink-0 flex items-center gap-0.5 p-0.5 rounded-full bg-nb-200/60">
				<button
					onclick={() => entries.toggleShowAll()}
					title={entries.showAll ? 'Show unread only' : 'Show all'}
					aria-label={entries.showAll ? 'Show unread only' : 'Show all'}
					class="grid place-items-center size-7.5 rounded-full text-nb-600 transition-colors hover:bg-navbar/70 hover:text-nb-900"
				>
					<Circle size={18} fill={entries.showAll ? 'none' : 'currentColor'} />
				</button>
				<div class="relative view-mode-dropdown">
					<button
						onclick={() => viewDropdownOpen = !viewDropdownOpen}
						title={currentViewMode.label}
						aria-haspopup="menu"
						aria-expanded={viewDropdownOpen}
						class="h-7.5 pl-1.5 pr-2 flex items-center gap-1 rounded-full transition-colors {viewDropdownOpen
							? 'bg-a-600 text-on-accent'
							: 'bg-navbar text-nb-900 shadow-[0_1px_2px_color-mix(in_oklab,var(--color-n-900)_10%,transparent)] hover:shadow-[0_0_0_1.5px_var(--color-nb-300),0_1px_2px_color-mix(in_oklab,var(--color-n-900)_10%,transparent)] transition-shadow'}"
					>
						<currentViewMode.icon size={18} />
						<!-- One icon, turned — not swapped: a swap detaches the clicked node mid-click. -->
						<ChevronDown
							size={12}
							strokeWidth={2.5}
							class="transition-transform {viewDropdownOpen ? 'rotate-180' : 'text-nb-400'}"
						/>
					</button>
					{#if viewDropdownOpen}
						<div class="absolute right-0 top-full mt-1.5 w-66 max-h-[calc(100vh-4rem)] overflow-y-auto bg-surface text-n-700 rounded-[14px] p-2 shadow-menu z-50">
							<div class="{sectionLabel}">View</div>
							{#each viewModes as mode (mode.id)}
								<button
									onclick={() => selectViewMode(mode.id)}
									title={mode.label}
									class="{menuItem} h-8.5 {ui.viewMode === mode.id ? 'bg-a-50 text-a-700 font-semibold' : 'hover:bg-n-50'}"
								>
									<mode.icon size={17} class="shrink-0" />
									<span class="flex-1">{mode.label}</span>
									{#if ui.viewMode === mode.id}
										<Check size={15} class="shrink-0" />
									{/if}
								</button>
							{/each}

							{#if !ui.isMobile}
								<div class="{menuDivider}"></div>
								<div class="{sectionLabel}">Reading pane</div>
								{#each layoutModes as mode (mode.id)}
									<button
										onclick={() => selectLayoutMode(mode.id)}
										class="{menuItem} h-11 hover:bg-n-50"
									>
										<span
											class="size-3.5 shrink-0 rounded-full {ui.layoutMode === mode.id
												? 'border-[4.5px] border-a-600'
												: 'border-[1.5px] border-n-300'}"
										></span>
										<span class="flex-1">{mode.label}</span>
										<img src={mode.img} alt="" class="w-16 h-10 shrink-0 object-contain" />
									</button>
								{/each}
							{/if}

							<div class="{menuDivider}"></div>
							<button
								onclick={() => ui.toggleAutoMarkRead()}
								role="menuitemcheckbox"
								aria-checked={ui.autoMarkReadOnScroll}
								class="{menuItem} h-8.5 hover:bg-n-50"
							>
								<span
									class="grid place-items-center size-4 shrink-0 rounded-[4px] {ui.autoMarkReadOnScroll
										? 'bg-a-600 text-on-accent'
										: 'border-[1.5px] border-n-300'}"
								>
									{#if ui.autoMarkReadOnScroll}
										<Check size={12} strokeWidth={3} />
									{/if}
								</span>
								Mark read on scroll
							</button>

							<div class="{menuDivider}"></div>
							<div class="{sectionLabel}">Theme</div>
							<div class="px-2.5 pt-1.5 pb-2 flex flex-wrap gap-3">
								{#each theme.all as t (t.id)}
									{@const swatch = resolveTheme(t)}
									<button
										onclick={() => theme.setTheme(t.id)}
										class="flex size-9 overflow-hidden rounded-full transition-shadow {theme.current === t.id
											? 'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-a-600)]'
											: 'shadow-[0_0_0_1px_var(--color-n-200)] hover:shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-n-300)]'}"
										title={t.label}
										aria-label="{t.label} theme"
										aria-pressed={theme.current === t.id}
									>
										<span class="block w-1/2 h-full" style="background:{swatch['n-200']}"></span>
										<span class="block w-1/2 h-full" style="background:{swatch['a-600']}"></span>
									</button>
								{/each}
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
				class="p-2 rounded-full shrink-0 transition-colors {dotMenu
					? 'bg-a-50 text-a-700'
					: 'text-nb-600 hover:bg-nb-200/60 hover:text-nb-900'}"
				title="Menu"
			>
				<EllipsisVertical size={18} />
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
		align="right"
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

