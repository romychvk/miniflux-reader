<script lang="ts">
	import { goto } from '$app/navigation';
	import { LogOut, Plus, Settings } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { resizable } from '$lib/actions/resize';
	import { makeFeedSlug } from '$lib/slug';
	import type { FeedCreate } from '$lib/types';
	import FeedTree from './FeedTree.svelte';
	import FeedAddModal from '$lib/components/ui/FeedAddModal.svelte';
	import ScrapedFeedWizard from '$lib/components/ui/ScrapedFeedWizard.svelte';

	let showAddModal = $state(false);
	let showWizard = $state(false);
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
	<div class="border-t border-n-200 p-3 mt-auto flex flex-col gap-2.5">
		<a
			href="/settings"
			class="flex items-center gap-2 text-sm text-n-500 hover:text-n-700 transition-colors w-full cursor-pointer"
		>
			<Settings size={16} />
			Settings
		</a>
		<button
			onclick={handleLogout}
			class="flex items-center gap-2 text-sm text-n-500 hover:text-n-700 transition-colors w-full cursor-pointer"
		>
			<LogOut size={16} />
			Logout
		</button>
	</div>
{/snippet}

<!-- Desktop sidebar -->
{#if !ui.isMobile}
	<aside
		class="h-screen border-r-2 border-r-n-200 bg-surface flex flex-col shrink-0 relative"
		style="width: {ui.sidebarWidth}px"
	>
		<div class="p-4 flex items-center justify-between">
			<h2 class="text-lg text-n-800 font-bold leading-none"><a href="/">Miniflux Reader</a></h2>
			<div class="flex items-center gap-1">
				<button
					onclick={() => openAddModal()}
					class="text-n-700 p-2 rounded-full hover:bg-n-200 transition-colors"
					title="Add feed"
				>
					<Plus size={20} />
				</button>
			</div>
		</div>
		<div class="overflow-y-auto flex-1">
			<FeedTree onAddFeed={openAddModal} />
		</div>
		{@render logoutButton()}
		<!-- Resize handle -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-10 hover:bg-a-400/30 transition-colors [&.active]:bg-a-400/30"
			use:resizable={{ getCurrentValue: () => ui.sidebarWidth, onResize: ui.setSidebarWidth }}
		></div>
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
	<aside class="fixed left-0 top-0 h-full w-72 bg-surface z-50 shadow-lg flex flex-col">
		<div class="p-3 border-b border-n-200 flex items-center justify-between">
			<h2 class="text-xl text-a-600 font-medium">Miniflux Reader</h2>
			<div class="flex items-center gap-2">
				<button
					onclick={() => openAddModal()}
					class="text-n-700 hover:bg-n-200 p-2 rounded-full transition-colors"
					title="Add feed"
				>
					<Plus size={20} />
				</button>
			</div>
		</div>
		<div class="overflow-y-auto flex-1">
			<FeedTree onAddFeed={openAddModal} />
		</div>
		{@render logoutButton()}
	</aside>
{/if}

{#if showAddModal}
	<FeedAddModal
		initialCategoryId={addFeedCategoryId}
		onclose={() => showAddModal = false}
		onsave={handleCreateFeed}
		onwizard={() => { showAddModal = false; showWizard = true; }}
	/>
{/if}

{#if showWizard}
	<ScrapedFeedWizard
		initialCategoryId={addFeedCategoryId}
		onclose={() => showWizard = false}
		onsave={handleCreateFeed}
	/>
{/if}
