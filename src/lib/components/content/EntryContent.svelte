<script lang="ts">
	import { onMount } from 'svelte';
	import type { Entry } from '$lib/types';
	import { entries } from '$lib/stores/entries.svelte';
	import Spinner from '../ui/Spinner.svelte';

	let { entry }: { entry: Entry } = $props();

	let originalContent = $state<string | null>(null);
	let fetching = $state(true);

	const content = $derived(
		originalContent && originalContent.length > entry.content.length
			? originalContent
			: entry.content
	);

	onMount(async () => {
		const original = await entries.fetchOriginalContent(entry.id);
		if (original) originalContent = original;
		fetching = false;
	});
</script>

<div class="py-3 px-1">
	{#if fetching}
		<Spinner />
	{/if}
	<article class="prose prose-sm max-w-none break-words">
		{@html content}
	</article>
</div>

<style>                                                                                                               
  @reference "../../../app.css";
  article.prose :global {
    p {
      @apply mb-4;
    }
    img {
      @apply mb-6;
    }
  }                                                                                                
</style>
