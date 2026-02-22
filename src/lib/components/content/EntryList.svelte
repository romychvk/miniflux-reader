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
		<div class="flex items-center justify-center py-12 text-n-400 text-sm">
			{#if entries.searchQuery}
				No results for "{entries.searchQuery}"
			{:else if ui.selectedFeed}
				No {entries.showAll ? '' : 'unread '}entries
			{:else}
				Select a feed
			{/if}
		</div>
	{:else if ui.viewMode === 'cards'}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 p-4">
			{#each entries.entries as entry (entry.id)}
				<EntryRow {entry} />
			{/each}
		</div>
	{:else}
		{#each entries.entries as entry (entry.id)}
			<EntryRow {entry} />
		{/each}
	{/if}
</div>
