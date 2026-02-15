<script lang="ts">
	import { feeds } from '$lib/stores/feeds.svelte';
	import FeedItem from './FeedItem.svelte';
	import { ChevronRight, ChevronDown } from 'lucide-svelte';
	import { ui } from '$lib/stores/ui.svelte';

	let expandedCategories = $state<Set<number>>(new Set());

	function toggleCategory(id: number) {
		if (expandedCategories.has(id)) {
			expandedCategories.delete(id);
		} else {
			expandedCategories.add(id);
		}
		expandedCategories = new Set(expandedCategories);
	}
</script>

<nav class="flex flex-col gap-0.5 p-2">
	{#each feeds.feedTree as node}
		{#if node.children}
			<!-- Category -->
			<button
				onclick={() => toggleCategory(node.id)}
				class="flex items-center gap-1 px-2 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded transition-colors w-full text-left"
			>
				{#if expandedCategories.has(node.id)}
					<ChevronDown size={14} />
				{:else}
					<ChevronRight size={14} />
				{/if}
				<span class="truncate flex-1">{node.title}</span>
				{#if node.unread > 0}
					<span class="text-xs text-gray-400 font-normal">{node.unread}</span>
				{/if}
			</button>
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
