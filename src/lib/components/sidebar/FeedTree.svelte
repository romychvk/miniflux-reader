<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import type { FeedNode } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { refresh } from '$lib/stores/refresh.svelte';
	import { dnd } from '$lib/stores/dnd.svelte';
	import FeedItem from './FeedItem.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import CategoryEditModal from '$lib/components/ui/CategoryEditModal.svelte';
	import { ChevronRight, ChevronDown, Pencil, RotateCw, Plus, ArrowDownAZ, FolderPlus, FolderTree } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { makeFeedSlug } from '$lib/slug';
	import { storageGet, storageSet } from '$lib/storage';
	import { isCategoryNode, isGroup, subtreeCategoryIds } from '$lib/categoryTree';

	// All and Bookmarks live in the desktop rail; only the mobile drawer (no rail) pins them here.
	// onAddCategory gets the category right-clicked (a feed's own one): the new category becomes
	// its sibling, placed after it. onAddSubcategory gets the category the new one goes under.
	let { onAddFeed, onAddCategory, onAddSubcategory, pinned = false }: {
		onAddFeed: (categoryId: number) => void;
		onAddCategory: (afterCategoryId?: number) => void;
		onAddSubcategory?: (parentId: number) => void;
		pinned?: boolean;
	} = $props();

	// How far each level of nesting moves a row to the right, in px.
	const INDENT = 14;

	let contextMenu = $state<{ x: number; y: number; catId: number } | null>(null);
	let editingCatId = $state<number | null>(null);

	let expandedCategories = $state<Set<number>>(
		new Set(storageGet<number[]>('expandedCategories', []))
	);

	function toggleCategory(id: number) {
		if (expandedCategories.has(id)) {
			expandedCategories.delete(id);
		} else {
			expandedCategories.add(id);
		}
		expandedCategories = new Set(expandedCategories);
		storageSet('expandedCategories', [...expandedCategories]);
	}

	function expand(id: number) {
		if (expandedCategories.has(id)) return;
		toggleCategory(id);
	}

	// A category opened by its link, or just made under a group, shows inside its group rather
	// than behind a collapsed one: its ancestors open. Untracked, so collapsing one of them by hand
	// afterwards stays collapsed.
	$effect(() => {
		const sel = ui.selectedFeed;
		if (!sel || sel.isFeed || sel.id <= 0) return;
		untrack(() => {
			for (let p = feeds.parentIdOf(sel.id); p !== null; p = feeds.parentIdOf(p)) expand(p);
		});
	});

	// Category drag handlers
	function onCatDragStart(e: DragEvent, catId: number) {
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.setData('text/plain', '');
		dnd.startDrag('category', catId);
	}

	function onCatDragEnd() {
		dnd.reset();
	}

	// Where a category dragged over this row would land. The middle half of the row puts it into
	// the row as its last subcategory, when the row can take one; otherwise the upper half puts it
	// before the row and the lower half after it, as a sibling under the row's parent. Never into
	// itself or anything under it, and never under a parent it may not go to (categoryTree rules).
	function categoryDropPosition(e: DragEvent, node: FeedNode): 'before' | 'after' | 'into' | null {
		const dragId = dnd.dragId;
		const dragged = dragId === null ? null : feeds.findFeedNodeById(dragId, false);
		if (dragId === null || !dragged || dragId === node.id || subtreeCategoryIds(dragged).has(node.id)) return null;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const y = (e.clientY - rect.top) / rect.height;
		if (y > 0.25 && y < 0.75 && feeds.canNest(dragId, node.id)) return 'into';
		const parent = feeds.parentIdOf(node.id);
		if (parent !== feeds.parentIdOf(dragId) && !feeds.canNest(dragId, parent)) return null;
		return y < 0.5 ? 'before' : 'after';
	}

	function onCatDragOver(e: DragEvent, node: FeedNode) {
		if (dnd.dragType === 'category') {
			const position = categoryDropPosition(e, node);
			if (!position) {
				dnd.setDropTarget(null);
				return;
			}
			e.preventDefault();
			e.dataTransfer!.dropEffect = 'move';
			dnd.setDropTarget({ type: 'category', catId: node.id, position });
		} else if (dnd.dragType === 'feed') {
			// A group holds no feeds: a feed goes into one of its subcategories.
			if (dnd.dragId === null || isGroup(node)) return;
			e.preventDefault();
			e.dataTransfer!.dropEffect = 'move';
			// Feed dropped onto category header → append at end
			dnd.setDropTarget({ type: 'feed', catId: node.id, insertIndex: node.children?.length ?? 0 });
		}
	}

	function onCatDragLeave() {
		dnd.setDropTarget(null);
	}

	function onCatDrop(e: DragEvent) {
		e.preventDefault();
		const target = dnd.dropTarget;
		const dragId = dnd.dragId;
		if (!target || dragId === null) return;

		if (dnd.dragType === 'category' && target.type === 'category') {
			if (target.position === 'into') {
				void feeds.placeCategory(dragId, target.catId);
				expand(target.catId);
			} else {
				const anchor = target.position === 'before' ? { before: target.catId } : { after: target.catId };
				void feeds.placeCategory(dragId, feeds.parentIdOf(target.catId), anchor);
			}
		} else if (dnd.dragType === 'feed' && target.type === 'feed') {
			const { catId: targetCatId, insertIndex } = target;
			if (dnd.dragSourceCatId === targetCatId) {
				feeds.reorderFeed(targetCatId, dragId, insertIndex);
			} else if (dnd.dragSourceCatId !== null) {
				feeds.moveFeedToCategory(dragId, dnd.dragSourceCatId, targetCatId, insertIndex);
			}
		}

		dnd.reset();
	}

	// Where a dragged category would land relative to this row, for the insert line or the ring.
	function categoryDrop(catId: number): 'before' | 'after' | 'into' | null {
		const t = dnd.dropTarget;
		return dnd.dragType === 'category' && t?.type === 'category' && t.catId === catId ? t.position : null;
	}

	// Only highlight category header when feed is dropped directly on it (not on children)
	function feedDropOnHeader(node: FeedNode): boolean {
		const t = dnd.dropTarget;
		return dnd.dragType === 'feed' && t?.type === 'feed' && t.catId === node.id && t.insertIndex === (node.children?.length ?? 0);
	}

	function feedLineAt(node: FeedNode, index: number): boolean {
		const t = dnd.dropTarget;
		return dnd.dragType === 'feed' && t?.type === 'feed' && t.catId === node.id && t.insertIndex === index;
	}

	// The line after the last feed only for a reorder within the category; a feed from elsewhere
	// dropped at the end lights the header instead.
	function feedLineAfterLast(node: FeedNode): boolean {
		return feedLineAt(node, node.children?.length ?? 0) && dnd.dragSourceCatId === node.id;
	}

	function onCatContextMenu(e: MouseEvent, catId: number) {
		e.preventDefault();
		contextMenu = { x: e.clientX, y: e.clientY, catId };
	}

	// A group holds no feeds, so it offers neither Add Feed nor the feed sort; Add Subcategory is
	// there when the category may take one (not the default, holds no feeds).
	const menuItems = $derived.by(() => {
		const catId = contextMenu?.catId;
		const node = catId === undefined ? null : feeds.findFeedNodeById(catId, false);
		if (catId === undefined || !node) return [];
		const group = isGroup(node);
		return [
			...(group ? [] : [{ label: 'Add Feed', icon: Plus, action: () => onAddFeed(catId) }]),
			{ label: 'Add Category', icon: FolderPlus, action: () => onAddCategory(catId) },
			...(onAddSubcategory && feeds.canAddSubcategory(catId)
				? [{ label: 'Add Subcategory', icon: FolderTree, action: () => onAddSubcategory(catId) }]
				: []),
			{ label: 'Edit Category', icon: Pencil, action: () => { editingCatId = catId; } },
			{ label: 'Refresh Feeds', icon: RotateCw, action: () => { void refresh.refreshNode(node); } },
			...(group ? [] : [{ label: 'Sort Feeds A–Z', icon: ArrowDownAZ, action: () => feeds.sortFeedsAlphabetically(catId) }])
		];
	});
</script>

{#snippet categoryRow(node: FeedNode, depth: number)}
	{@const isSelected = ui.selectedFeed?.id === node.id && !ui.selectedFeed?.isFeed}
	{@const isCatDragged = dnd.dragType === 'category' && dnd.dragId === node.id}
	{@const drop = categoryDrop(node.id)}
	{@const pad = 8 + depth * INDENT}
	{#if drop === 'before'}
		<div class="h-0.5 bg-a-500 mr-2 rounded" style="margin-left: {pad}px"></div>
	{/if}
	<div
		role="listitem"
		class="flex items-center gap-2 h-8 pr-2 rounded-lg text-[13.5px] leading-5 transition-colors
			{isSelected
				? `bg-a-600/12 text-a-700 ${node.unread > 0 ? 'font-[650]' : 'font-[450]'}`
				: `hover:bg-sb-200/60 hover:text-sb-900 ${node.unread > 0 ? 'text-sb-900 font-semibold' : 'text-sb-600 font-[450]'}`}
			{isCatDragged ? 'opacity-40' : ''}
			{drop === 'into' || feedDropOnHeader(node) ? 'ring-2 ring-a-400 bg-a-50' : ''}"
		style="padding-left: {pad}px"
		draggable="true"
		oncontextmenu={(e: MouseEvent) => onCatContextMenu(e, node.id)}
		ondragstart={(e: DragEvent) => onCatDragStart(e, node.id)}
		ondragend={onCatDragEnd}
		ondragover={(e: DragEvent) => onCatDragOver(e, node)}
		ondragleave={onCatDragLeave}
		ondrop={(e: DragEvent) => onCatDrop(e)}
	>
		<button
			onclick={() => toggleCategory(node.id)}
			class="w-4.5 h-full grid place-items-center shrink-0 text-sb-400"
			aria-label="{expandedCategories.has(node.id) ? 'Collapse' : 'Expand'} {node.title}"
		>
			{#if expandedCategories.has(node.id)}
				<ChevronDown size={16} strokeWidth={2.2} />
			{:else}
				<ChevronRight size={16} strokeWidth={2.2} />
			{/if}
		</button>
		<button
			onclick={() => {
				goto(`/category/${makeFeedSlug(node.id, node.title)}`);
				if (ui.isMobile) ui.toggleSidebar();
			}}
			class="flex items-center gap-2 flex-1 min-w-0 h-full text-left"
		>
			<span class="truncate flex-1 pointer-events-none">{node.title}</span>
			{#if node.unread > 0}
				<span
					class="text-[11.5px] tabular-nums pointer-events-none {isSelected
						? 'text-a-700 font-bold'
						: 'text-sb-600 font-medium'}">{node.unread}</span
				>
			{/if}
		</button>
	</div>
	{#if expandedCategories.has(node.id) && node.children}
		<div class="flex flex-col gap-px">
			<!-- Subcategories first, then feeds; their ids are separate sequences, hence the prefix. -->
			{#each node.children as child, childIndex (child.isFeed ? `f${child.id}` : `c${child.id}`)}
				{#if child.isFeed}
					{#if feedLineAt(node, childIndex)}
						<div class="h-0.5 bg-a-500 mr-2 rounded" style="margin-left: {pad}px"></div>
					{/if}
					<FeedItem feed={child} parentCatId={node.id} {depth} {onAddCategory} />
				{:else}
					{@render categoryRow(child, depth + 1)}
				{/if}
			{/each}
			{#if feedLineAfterLast(node)}
				<div class="h-0.5 bg-a-500 mr-2 rounded" style="margin-left: {pad}px"></div>
			{/if}
		</div>
	{/if}
	{#if drop === 'after'}
		<div class="h-0.5 bg-a-500 mr-2 rounded" style="margin-left: {pad}px"></div>
	{/if}
{/snippet}

<nav class="flex flex-col gap-px pl-2 pr-0.5 pt-0.5 pb-2">
	{#each feeds.feedTree as node (node.id)}
		{#if isCategoryNode(node)}
			{@render categoryRow(node, 0)}
		{:else if pinned}
			<!-- Top-level item (All) — in the drawer only; the desktop rail carries it -->
			<FeedItem feed={node} />
			{#if node.id === -1}
				<!-- Bookmarks (Miniflux starred) pseudo-feed, right under "All" -->
				<FeedItem feed={feeds.getStarredNode()} />
			{/if}
		{/if}
	{/each}
</nav>

{#if contextMenu}
	<ContextMenu
		x={contextMenu.x}
		y={contextMenu.y}
		items={menuItems}
		onclose={() => { contextMenu = null; }}
	/>
{/if}

{#if editingCatId !== null}
	{@const catNode = feeds.findFeedNodeById(editingCatId, false)}
	{#if catNode}
		<CategoryEditModal
			title={catNode.title}
			categoryId={catNode.id}
			onclose={() => { editingCatId = null; }}
			onsave={(title, parentId) => feeds.editCategory(catNode.id, title, parentId)}
		/>
	{/if}
{/if}
