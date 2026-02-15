<script lang="ts">
	import { feeds } from '$lib/stores/feeds.svelte';
	import FeedItem from './FeedItem.svelte';
	import { ChevronRight, ChevronDown } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';

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
</script>

<nav class="flex flex-col gap-0.5 p-2">
	{#each feeds.feedTree as node}
		{#if node.children}
			<!-- Category -->
			{@const isSelected = ui.selectedFeed?.id === node.id && !ui.selectedFeed?.isFeed}
			<div class="flex items-center gap-0 rounded hover:bg-gray-100 transition-colors {isSelected ? 'bg-gray-200 font-medium' : ''}">
				<button
					onclick={() => toggleCategory(node.id)}
					class="p-1.5 shrink-0"
					aria-label="{expandedCategories.has(node.id) ? 'Collapse' : 'Expand'} {node.title}"
				>
					{#if expandedCategories.has(node.id)}
						<ChevronDown size={14} />
					{:else}
						<ChevronRight size={14} />
					{/if}
				</button>
				<button
					onclick={() => ui.selectFeed(node)}
					class="flex items-center gap-1 flex-1 min-w-0 py-1.5 pr-2 text-sm text-gray-600 text-left {isSelected ? 'font-medium' : 'font-semibold'}"
				>
					<span class="truncate flex-1">{node.title}</span>
					{#if node.unread > 0}
						<span class="text-xs text-gray-400 font-normal">{node.unread}</span>
					{/if}
				</button>
			</div>
			{#if expandedCategories.has(node.id)}
				<div class="ml-4 flex flex-col gap-0.5">
					{#each node.children as child}
						<FeedItem feed={child} />
					{/each}
				</div>
			{/if}
		{:else}
			<!-- Top-level item (All) -->
			<FeedItem feed={node} />
		{/if}
	{/each}
</nav>
