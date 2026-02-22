<script lang="ts">
	import { ArrowLeft } from 'lucide-svelte';
	import type { Entry } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { relaTimestamp } from '$lib/time';
	import EntryContent from './EntryContent.svelte';

	let { entry }: { entry: Entry } = $props();

	const feedIcon = $derived(feeds.findFeedNodeById(entry.feed.id, true)?.iconData);
  
	function goBack() {
		history.back();
	}
</script>

<div class="max-w-3xl mx-auto px-8 py-6">
	<button
		onclick={goBack}
		class="flex items-center gap-1 text-sm text-n-500 hover:text-n-700 mb-4"
	>
		<ArrowLeft size={16} />
		Back
	</button>

	<h1 class="text-3xl font-bold mb-3">
		<a href={entry.url} target="_blank" rel="noopener noreferrer" class="hover:underline">{entry.title}</a>
	</h1>

	<div class="flex items-center gap-2 text-sm text-n-500 mb-4">
		{#if feedIcon}
			<img src={feedIcon} alt="" class="size-5 shrink-0" />
		{/if}
		<span>{entry.feed.title}</span>
    <span>&middot;</span>
		<span>{relaTimestamp(entry.published_at)}</span>
		{#if entry.author}
			<span>&middot;</span>
			<span>{entry.author}</span>
		{/if}
	</div>

	<EntryContent {entry} />
</div>
