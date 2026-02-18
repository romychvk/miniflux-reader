<script lang="ts">
	import { goto } from '$app/navigation';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { dnd } from '$lib/stores/dnd.svelte';
	import FeedItem from './FeedItem.svelte';
	import { ChevronRight, ChevronDown } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { makeFeedSlug } from '$lib/slug';

	let expandedCategories = $state<Set<number>>(
		new Set(JSON.parse(localStorage.getItem('expandedCategories') || '[]'))
	);

	function toggleCategory(id: number) {
		if (expandedCategories.has(id)) {
			expandedCategories.delete(id);
		} else {
			expandedCategories.add(id);
		}
		expandedCategories = new Set(expandedCategories);
		localStorage.setItem('expandedCategories', JSON.stringify([...expandedCategories]));
	}

	// Category drag handlers
	function onCatDragStart(e: DragEvent, catId: number) {
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.setData('text/plain', '');
		dnd.startDrag('category', catId);
	}

	function onCatDragEnd() {
		dnd.reset();
	}

	function onCatDragOver(e: DragEvent, catId: number, catIndex: number) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';

		if (dnd.dragType === 'category') {
			if (dnd.dragId === catId) return;
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			// catIndex is relative to feedTree (includes "All" at 0)
			const insertIndex = e.clientY < midY ? catIndex : catIndex + 1;
			dnd.setDropTarget({ type: 'category', catId, insertIndex });
		} else if (dnd.dragType === 'feed') {
			if (dnd.dragId === null) return;
			// Feed dropped onto category header → append at end
			const cat = feeds.feedTree.find(n => n.id === catId);
			const insertIndex = cat?.children?.length ?? 0;
			dnd.setDropTarget({ type: 'feed', catId, insertIndex });
		}
	}

	function onCatDragLeave() {
		dnd.setDropTarget(null);
	}

	function onCatDrop(e: DragEvent, catId: number) {
		e.preventDefault();
		if (!dnd.dropTarget || dnd.dragId === null) return;

		if (dnd.dragType === 'category') {
			feeds.reorderCategory(dnd.dragId, dnd.dropTarget.insertIndex);
		} else if (dnd.dragType === 'feed') {
			const { catId: targetCatId, insertIndex } = dnd.dropTarget;
			if (dnd.dragSourceCatId === targetCatId) {
				feeds.reorderFeed(targetCatId, dnd.dragId, insertIndex);
			} else if (dnd.dragSourceCatId !== null) {
				feeds.moveFeedToCategory(dnd.dragId, dnd.dragSourceCatId, targetCatId, insertIndex);
			}
		}

		dnd.reset();
	}

	function isCatDropTarget(catId: number): boolean {
		if (!dnd.dropTarget) return false;
		if (dnd.dragType === 'feed' && dnd.dropTarget.type === 'feed' && dnd.dropTarget.catId === catId) {
			// Only highlight category header when feed is dropped directly on it (not on children)
			const cat = feeds.feedTree.find(n => n.id === catId);
			return dnd.dropTarget.insertIndex === (cat?.children?.length ?? 0);
		}
		return false;
	}

	function showInsertLine(catId: number, feedIndex: number): boolean {
		if (!dnd.dropTarget) return false;
		if (dnd.dragType !== 'feed') return false;
		if (dnd.dropTarget.catId !== catId) return false;
		// Don't show insertion line if it's the "append at end" case (handled by category highlight)
		const cat = feeds.feedTree.find(n => n.id === catId);
		if (!cat?.children) return false;
		return dnd.dropTarget.insertIndex === feedIndex;
	}

	function showInsertLineAfterLast(catId: number): boolean {
		if (!dnd.dropTarget) return false;
		if (dnd.dragType !== 'feed') return false;
		if (dnd.dropTarget.catId !== catId) return false;
		const cat = feeds.feedTree.find(n => n.id === catId);
		if (!cat?.children) return false;
		// Show after last item only if insert index equals length and source is same category (reorder within)
		return dnd.dropTarget.insertIndex === cat.children.length && dnd.dragSourceCatId === catId;
	}

	function showCatInsertLine(treeIndex: number): boolean {
		if (!dnd.dropTarget) return false;
		if (dnd.dragType !== 'category') return false;
		return dnd.dropTarget.insertIndex === treeIndex;
	}
</script>

<nav class="flex flex-col gap-0.5 p-2">
	{#each feeds.feedTree as node, treeIndex}
		{#if node.children}
			<!-- Category insert line (before) -->
			{#if showCatInsertLine(treeIndex)}
				<div class="h-0.5 bg-blue-500 mx-2 rounded"></div>
			{/if}

			<!-- Category -->
			{@const isSelected = ui.selectedFeed?.id === node.id && !ui.selectedFeed?.isFeed}
			{@const isCatDragged = dnd.dragType === 'category' && dnd.dragId === node.id}
			{@const isCatTarget = isCatDropTarget(node.id)}
			<div
				role="listitem"
				class="flex items-center gap-0 rounded hover:bg-slate-200 transition-colors
          {isSelected ? 'bg-slate-200 text-p-dark' : 'text-slate-900'}
					{isCatDragged ? 'opacity-40' : ''}
					{isCatTarget ? 'ring-2 ring-blue-400 bg-blue-50' : ''}"
				draggable="true"
				ondragstart={(e: DragEvent) => onCatDragStart(e, node.id)}
				ondragend={onCatDragEnd}
				ondragover={(e: DragEvent) => onCatDragOver(e, node.id, treeIndex)}
				ondragleave={onCatDragLeave}
				ondrop={(e: DragEvent) => onCatDrop(e, node.id)}
			>
				<button
					onclick={() => toggleCategory(node.id)}
					class="p-1.5 shrink-0"
					aria-label="{expandedCategories.has(node.id) ? 'Collapse' : 'Expand'} {node.title}"
				>
					{#if expandedCategories.has(node.id)}
						<ChevronDown size={20} />
					{:else}
						<ChevronRight size={20} />
					{/if}
				</button>
				<button
					onclick={() => {
						goto(`/category/${makeFeedSlug(node.id, node.title)}`);
						if (ui.isMobile) ui.toggleSidebar();
					}}
					class="
            flex items-center gap-1 flex-1 min-w-0 py-1.5 pr-2 text-sm text-left 
            
            {node.unread > 0 ? 'font-bold' : ''}
          "
				>
					<span class="truncate flex-1 pointer-events-none">{node.title}</span>
					{#if node.unread > 0}
						<span class="text-xs text-slate-400 font-normal pointer-events-none">{node.unread}</span>
					{/if}
				</button>
			</div>
			{#if expandedCategories.has(node.id)}
				<div class="ml-6 flex flex-col">
					{#each node.children as child, childIndex}
						{#if showInsertLine(node.id, childIndex)}
							<div class="h-0.5 bg-blue-500 mx-2 rounded"></div>
						{/if}
						<FeedItem feed={child} parentCatId={node.id} />
					{/each}
					{#if showInsertLineAfterLast(node.id)}
						<div class="h-0.5 bg-blue-500 mx-2 rounded"></div>
					{/if}
				</div>
			{/if}
		{:else}
			<!-- Top-level item (All) -->
			<FeedItem feed={node} />
		{/if}
	{/each}
	<!-- Category insert line (after last category) -->
	{#if showCatInsertLine(feeds.feedTree.length)}
		<div class="h-0.5 bg-blue-500 mx-2 rounded"></div>
	{/if}
</nav>
