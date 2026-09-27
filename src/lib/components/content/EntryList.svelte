<script lang="ts">
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import EntryRow from './EntryRow.svelte';
	import Spinner from '../ui/Spinner.svelte';
</script>

<!-- No scrolling here: <main> is the list's scroll container (autoMarkRead roots its observer
     there too). A second `overflow-y-auto` on this wrapper looks inert — the box is height-auto,
     so it never scrolls on its own — right up until a hovered card grows out of the bottom row:
     the absolute card counts as scrollable overflow, the wrapper turns into a real scroll
     container, and its scrollbar appears and shoves the whole grid sideways. -->
<div>
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

	{:else if ui.viewMode === 'magazine'}
		<!-- Cards' spacing. One column until the content area is genuinely wide enough for two
		     (@6xl = 1152px). The container is this outer div, so it measures the available width;
		     each row carries its own @container/mag and so responds to its column (a narrow card
		     drops its picture), not to the window. items-stretch: a row of two reads as one height. -->
		<div class="@container/maglist">
			<div
				class="grid grid-cols-1 gap-4 p-4 items-stretch
				       @6xl/maglist:grid-cols-2 @6xl/maglist:max-w-[1600px]"
			>
				{#each entries.entries as entry (entry.id)}
					<EntryRow {entry} />
				{/each}
			</div>
		</div>
	{:else if ui.viewMode === 'cards'}
		<!-- 243px is the narrowest a card gets: it keeps four columns down to a 1064px-wide <main>
		     (10px scrollbar gutter + p-4 + three gap-4 + 4×243), three down to ~803px. -->
		<div class="grid grid-cols-[repeat(auto-fill,minmax(243px,1fr))] gap-4 p-4">
			{#each entries.entries as entry (entry.id)}
				<EntryRow {entry} />
			{/each}
		</div>
	{:else}
		<!-- List: the rows share one sheet. It is also the @container that drops the rows'
		     feed · time meta when the list gets narrow. -->
		<div class="p-4">
			<div class="@container rounded-xl bg-surface shadow-card overflow-hidden">
				{#each entries.entries as entry (entry.id)}
					<EntryRow {entry} />
				{/each}
			</div>
		</div>
	{/if}
</div>
