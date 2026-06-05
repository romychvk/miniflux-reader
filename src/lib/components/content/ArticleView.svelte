<script lang="ts">
	import { ArrowLeft, X, RotateCw } from 'lucide-svelte';
	import type { Entry } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { relaTimestamp } from '$lib/time';
	import EntryContent from './EntryContent.svelte';

	let { entry, onClose }: { entry: Entry; onClose?: () => void } = $props();

	const feedIcon = $derived(feeds.findFeedNodeById(entry.feed.id, true)?.iconData);

	let refetching = $state(false);

	async function refetch() {
		refetching = true;
		const content = await entries.refetchContent(entry.id);
		if (content !== null) {
			entry.content = content;
			ui.showSuccess('Content re-fetched.');
		}
		refetching = false;
	}

	function goBack() {
		history.back();
	}
</script>

<div class="max-w-3xl mx-auto px-8 py-6 relative">
	{#if onClose}
		<button
			onclick={onClose}
			class="absolute top-4 right-4 p-1 rounded-md text-n-400 hover:text-n-700 hover:bg-n-100 transition-colors z-10"
			title="Close article"
		>
			<X size={18} />
		</button>
	{:else}
		<button
			onclick={goBack}
			class="flex items-center gap-1 text-sm text-n-500 hover:text-n-700 mb-4"
		>
			<ArrowLeft size={16} />
			Back
		</button>
	{/if}

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
		<button
			onclick={refetch}
			disabled={refetching}
			title="Re-fetch original content (applies the feed's rules)"
			class="ml-auto shrink-0 p-1 rounded-md text-n-400 hover:text-n-700 hover:bg-n-100 transition-colors disabled:opacity-50"
		>
			<RotateCw size={14} class={refetching ? 'animate-spin' : ''} />
		</button>
	</div>

	<EntryContent {entry} />
</div>
