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
		<!-- Cards' spacing. One column until the content area is wide enough for two (68rem =
		     1088px: each column ~515px, a 240px picture beside ~275px of text). The container is
		     this outer div, so it measures the available width; each row carries its own
		     @container/mag and so responds to its column (a narrow card stacks its picture on top),
		     not to the window. items-stretch: a row of two reads as one height. A single column stops
		     at a 720px card (752 with the p-4), centred: a 448px text column, ~70 characters of
		     summary a line, where full width would run lines too long to read. -->
		<div class="@container/maglist">
			<div
				class="grid grid-cols-1 gap-4 p-4 items-stretch max-w-[752px] mx-auto
				       @min-[68rem]/maglist:grid-cols-2 @min-[68rem]/maglist:max-w-[1600px]"
			>
				{#each entries.entries as entry (entry.id)}
					<EntryRow {entry} />
				{/each}
			</div>
		</div>
	{:else if ui.viewMode === 'cards'}
		<!-- 242px is the narrowest a card gets: it keeps four columns down to a 1064px-wide <main>
		     (15px default scrollbar gutter + p-4 + three gap-4 + 4×242), three down to ~805px. -->
		<div class="@container/cardlist">
			<div class="grid grid-cols-[repeat(auto-fill,minmax(242px,1fr))] gap-4 p-4">
				{#each entries.entries as entry (entry.id)}
					<EntryRow {entry} />
				{/each}
			</div>
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
