<script lang="ts">
	import { ArrowLeft, ExternalLink } from 'lucide-svelte';
	import type { Entry } from '$lib/types';
	import { relaTimestamp } from '$lib/time';
	import EntryContent from './EntryContent.svelte';

	let { entry }: { entry: Entry } = $props();

	function goBack() {
		history.back();
	}
</script>

<div class="max-w-3xl mx-auto px-4 py-4">
	<button
		onclick={goBack}
		class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
	>
		<ArrowLeft size={16} />
		Back
	</button>

	<h1 class="text-xl font-bold mb-2">{entry.title}</h1>

	<div class="flex items-center gap-2 text-sm text-gray-500 mb-4">
		<span>{entry.feed.title}</span>
		<span>&middot;</span>
		<span>{relaTimestamp(entry.published_at)}</span>
		{#if entry.author}
			<span>&middot;</span>
			<span>{entry.author}</span>
		{/if}
		<a
			href={entry.url}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex items-center gap-1 text-blue-600 hover:underline ml-auto"
		>
			<ExternalLink size={14} />
			Original
		</a>
	</div>

	<EntryContent {entry} />
</div>
