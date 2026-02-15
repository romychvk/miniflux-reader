<script lang="ts">
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import EntryRow from './EntryRow.svelte';
	import Spinner from '../ui/Spinner.svelte';
</script>

<div class="flex-1 overflow-y-auto">
	{#if entries.loading}
		<div class="flex items-center justify-center py-12">
			<Spinner />
		</div>
	{:else if entries.entries.length === 0}
		<div class="flex items-center justify-center py-12 text-gray-400 text-sm">
			{#if ui.selectedFeed}
				No {entries.showAll ? '' : 'unread '}entries
			{:else}
				Select a feed
			{/if}
		</div>
	{:else}
		{#each entries.entries as entry (entry.id)}
			<EntryRow {entry} />
		{/each}
	{/if}
</div>
