<script lang="ts">
	import type { FeedNode } from '$lib/types';
	import { ui } from '$lib/stores/ui.svelte';

	let { feed }: { feed: FeedNode } = $props();

	const isSelected = $derived(ui.selectedFeed?.id === feed.id && ui.selectedFeed?.isFeed === feed.isFeed);
</script>

<button
	onclick={() => ui.selectFeed(feed)}
	class="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-gray-200 transition-colors text-left {isSelected ? 'bg-gray-200 font-medium' : ''}"
>
	{#if feed.iconData}
		<img src={feed.iconData} alt="" class="w-4 h-4 shrink-0" />
	{/if}
	<span class="truncate flex-1">{feed.title}</span>
	{#if feed.unread > 0}
		<span class="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">
			{feed.unread}
		</span>
	{/if}
</button>
