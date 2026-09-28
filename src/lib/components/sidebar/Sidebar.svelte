<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { LogOut, Plus, RotateCw, Settings } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { refresh } from '$lib/stores/refresh.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { resizable } from '$lib/actions/resize';
	import { makeFeedSlug } from '$lib/slug';
	import type { FeedCreate } from '$lib/types';
	import FeedTree from './FeedTree.svelte';
	import Rail from './Rail.svelte';
	import SettingsNav from './SettingsNav.svelte';
	import FeedAddModal from '$lib/components/ui/FeedAddModal.svelte';
	import ScrapedFeedWizard from '$lib/components/ui/ScrapedFeedWizard.svelte';
	import BridgeFeedWizard from '$lib/components/ui/BridgeFeedWizard.svelte';
	import PageFeedWizard from '$lib/components/ui/PageFeedWizard.svelte';
	import type { BridgeChoice } from '$lib/bridgeFinder';

	// Zen mode slides the desktop sidebar off the left edge instead of unmounting it: the feed
	// tree's scroll container has to survive, or every article open/close would snap it back to
	// the top. Margins take part in flex layout, so <main> reclaims the width either way.
	//
	// Staying mounted means browser page translation would still walk the whole feed tree — dozens
	// of feed and category names nobody can see — so while it is parked off-screen the sidebar
	// opts out via translate="no" (with the legacy .notranslate class Google Translate also honours).
	let { collapsed = false }: { collapsed?: boolean } = $props();

	const RAIL_WIDTH = 52; // Rail.svelte's w-13

	// App settings swap the feed tree for their own section list, in the same column.
	const isAppSettings = $derived(page.route.id === '/(app)/settings');

	let showAddModal = $state(false);
	// The two "feed from a page" wizards: Miniflux Reader's own page feed (default) and the RSS-Bridge
	// CssSelectorBridge one (offered only when the user has an instance).
	let showPageFeedWizard = $state(false);
	let showWizard = $state(false);
	// Handed to either wizard from Add Feed, so the URL (and the category already picked there)
	// isn't chosen twice.
	let wizardPageUrl = $state('');
	let wizardCategoryId = $state<number | undefined>(undefined);
	// Set when Add Feed offered a ready-made bridge and the user picked one.
	let showBridgeWizard = $state(false);
	let bridgeChoice = $state.raw<BridgeChoice | null>(null);
	// Category to preselect in the Add Feed modal; set when opened from a category's
	// right-click menu, undefined when opened from the header "+" button.
	let addFeedCategoryId = $state<number | undefined>(undefined);

	function openAddModal(categoryId?: number) {
		addFeedCategoryId = categoryId;
		showAddModal = true;
	}

	// After a feed is created, open it so the user lands on their new feed
	// instead of having to hunt for it in the sidebar.
	async function handleCreateFeed(data: FeedCreate) {
		const id = await feeds.createFeed(data);
		if (id == null) return;
		const node = feeds.findFeedNodeById(id, true);
		if (node) goto(`/feed/${makeFeedSlug(node.id, node.title)}`);
		if (ui.isMobile) ui.toggleSidebar();
	}

	function handleLogout() {
		auth.logout();
		goto('/login');
	}
</script>

{#snippet logoutButton()}
	<div class="border-t border-sb-200 p-3 mt-auto flex justify-between gap-2.5">
		<a
			href="/settings"
			class="flex items-center gap-2 text-sm text-sb-500 hover:text-sb-700 transition-colors w-full cursor-pointer"
		>
			<Settings size={16} />
			Settings
		</a>
		<button
			onclick={handleLogout}
			class="flex items-center justify-end gap-2 text-sm text-sb-500 hover:text-sb-700 transition-colors w-full cursor-pointer"
		>
			<LogOut size={16} />
			Logout
		</button>
	</div>
{/snippet}

<!-- Desktop sidebar -->
{#if !ui.isMobile}
	<!-- Rail + tree slide away together; the resize handle only ever resizes the tree. -->
	<aside
		translate={collapsed ? 'no' : 'yes'}
		class:notranslate={collapsed}
		class="h-screen flex shrink-0 relative transition-[margin-left] duration-200 ease-out motion-reduce:transition-none"
		style="margin-left: {collapsed ? -(ui.sidebarWidth + RAIL_WIDTH) : 0}px"
	>
		<Rail />
		<div
			class="h-full border-r border-r-sb-200 bg-sidebar text-sidebar-fg flex flex-col relative"
			style="width: {ui.sidebarWidth}px"
		>
			{#if isAppSettings}
				<SettingsNav />
			{:else}
				<div class="h-13 shrink-0 pl-4 pr-2.5 flex items-center justify-between">
					<h2 class="text-[15px] font-bold tracking-[-0.01em] text-sb-900">Feeds</h2>
					<button
						onclick={() => openAddModal()}
						class="h-7 pl-1.75 pr-2.5 flex items-center gap-1 rounded-full bg-a-50 text-a-700 text-[12.5px] font-semibold transition-colors hover:bg-a-600/12 hover:text-a-600 active:bg-a-600 active:text-on-accent"
						title="Add feed"
					>
						<Plus size={14} strokeWidth={2.5} />
						Add
					</button>
				</div>
				<div class="scroll-quiet flex-1">
					<FeedTree onAddFeed={openAddModal} />
				</div>
			{/if}
			<!-- Resize handle -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-10 hover:bg-a-500/30 transition-colors [&.active]:bg-a-500/30"
				use:resizable={{ getCurrentValue: () => ui.sidebarWidth, onResize: ui.setSidebarWidth }}
			></div>
		</div>
	</aside>
{/if}

<!-- Mobile drawer overlay -->
{#if ui.isMobile && ui.sidebarOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-overlay/30 z-40"
		onclick={() => ui.toggleSidebar()}
		onkeydown={(e) => e.key === 'Escape' && ui.toggleSidebar()}
	></div>
	<aside class="fixed left-0 top-0 h-full w-72 bg-sidebar z-50 shadow-lg flex flex-col">
		<div class="p-3 border-b border-sb-200 flex items-center justify-between">
			<h2 class="text-xl text-a-600 font-medium">Miniflux Reader</h2>
			<div class="flex items-center gap-2">
				<button
					onclick={() => { void refresh.refreshCurrent(); ui.toggleSidebar(); }}
					disabled={!ui.selectedFeed || refresh.refreshing}
					class="text-sb-700 hover:bg-sb-200 p-2 rounded-full transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
					title={ui.selectedFeed?.isFeed ? 'Refresh Feed' : 'Refresh Feeds'}
				>
					<RotateCw size={20} />
				</button>
				<button
					onclick={() => openAddModal()}
					class="text-sb-700 hover:bg-sb-200 p-2 rounded-full transition-colors"
					title="Add feed"
				>
					<Plus size={20} />
				</button>
			</div>
		</div>
		<div class="scroll-quiet flex-1">
			<FeedTree onAddFeed={openAddModal} pinned />
		</div>
		{@render logoutButton()}
	</aside>
{/if}

{#if showAddModal}
	<FeedAddModal
		initialCategoryId={addFeedCategoryId}
		onclose={() => showAddModal = false}
		onsave={handleCreateFeed}
		onpagefeed={(url, categoryId) => {
			wizardPageUrl = url;
			wizardCategoryId = categoryId ?? addFeedCategoryId;
			showAddModal = false;
			showPageFeedWizard = true;
		}}
		onwizard={(url) => { wizardPageUrl = url; showAddModal = false; showWizard = true; }}
		onbridge={(choice) => { bridgeChoice = choice; showAddModal = false; showBridgeWizard = true; }}
	/>
{/if}

{#if showPageFeedWizard}
	<PageFeedWizard
		initialCategoryId={wizardCategoryId}
		initialPageUrl={wizardPageUrl}
		onclose={() => showPageFeedWizard = false}
		onsave={handleCreateFeed}
	/>
{/if}

{#if showWizard}
	<ScrapedFeedWizard
		initialCategoryId={addFeedCategoryId}
		initialPageUrl={wizardPageUrl}
		onclose={() => showWizard = false}
		onsave={handleCreateFeed}
	/>
{/if}

{#if showBridgeWizard && bridgeChoice}
	<BridgeFeedWizard
		bridge={bridgeChoice.bridge}
		instance={bridgeChoice.instance}
		sourceUrl={bridgeChoice.sourceUrl}
		initialCategoryId={addFeedCategoryId}
		onclose={() => showBridgeWizard = false}
		onsave={handleCreateFeed}
	/>
{/if}
