<script lang="ts">
	import { goto } from '$app/navigation';
	import type { FeedNode } from '$lib/types';
	import { ui } from '$lib/stores/ui.svelte';
	import { dnd } from '$lib/stores/dnd.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { makeFeedSlug } from '$lib/slug';

	let { feed, parentCatId }: { feed: FeedNode; parentCatId?: number } = $props();

	const isSelected = $derived(ui.selectedFeed?.id === feed.id && ui.selectedFeed?.isFeed === feed.isFeed);
	const isDragged = $derived(dnd.dragType === 'feed' && dnd.dragId === feed.id);
	const isDraggable = $derived(feed.id !== -1 && feed.isFeed);

	function ondragstart(e: DragEvent) {
		if (!isDraggable || parentCatId === undefined) return;
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.setData('text/plain', '');
		dnd.startDrag('feed', feed.id, parentCatId);
	}

	function ondragend() {
		dnd.reset();
	}

	function ondragover(e: DragEvent) {
		if (feed.id === -1) return;
		if (dnd.dragType !== 'feed') return;
		if (dnd.dragId === feed.id) return;
		if (parentCatId === undefined) return;

		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';

		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		const cat = feeds.feedTree.find(n => n.id === parentCatId);
		if (!cat?.children) return;

		const feedIndex = cat.children.findIndex(f => f.id === feed.id);
		const insertIndex = e.clientY < midY ? feedIndex : feedIndex + 1;

		dnd.setDropTarget({ type: 'feed', catId: parentCatId, insertIndex });
	}

	function ondragleave() {
		dnd.setDropTarget(null);
	}

	function ondrop(e: DragEvent) {
		e.preventDefault();
		if (!dnd.dropTarget || dnd.dragType !== 'feed' || dnd.dragId === null) return;

		const { catId, insertIndex } = dnd.dropTarget;

		if (dnd.dragSourceCatId === catId) {
			feeds.reorderFeed(catId, dnd.dragId, insertIndex);
		} else if (dnd.dragSourceCatId !== null) {
			feeds.moveFeedToCategory(dnd.dragId, dnd.dragSourceCatId, catId, insertIndex);
		}

		dnd.reset();
	}
</script>

<button
	onclick={() => {
		if (feed.id === -1) goto('/');
		else if (feed.isFeed) goto(`/feed/${makeFeedSlug(feed.id, feed.title)}`);
		else goto(`/category/${makeFeedSlug(feed.id, feed.title)}`);
		if (ui.isMobile) ui.toggleSidebar();
	}}
	draggable={isDraggable}
	{ondragstart}
	{ondragend}
	{ondragover}
	{ondragleave}
	{ondrop}
	class="w-full flex items-center gap-2 px-2 py-1.75 text-sm rounded hover:bg-slate-200 text-left {isSelected ? 'bg-slate-200 text-p-dark' : ''} {feed.unread > 0 ? 'font-bold' : ''} {isDragged ? 'opacity-40' : ''}"
>
	{#if feed.iconData}
		<img src={feed.iconData} alt="" class="w-4 h-4 shrink-0 pointer-events-none" />
	{/if}
	<span class="truncate flex-1 pointer-events-none">{feed.title}</span>
	{#if feed.unread > 0}
		<span class="pl-2 text-xs text-slate-600 font-normal shrink-0 pointer-events-none">
			{feed.unread}
		</span>
	{/if}
</button>
