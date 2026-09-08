<script lang="ts">
	import type { PageFeedItem, PageFeedMode } from '$lib/pageFeed';

	// What the server extracted for the current config — the same list Miniflux will receive.
	let {
		items,
		matched,
		limit = 20,
		mode = 'cards'
	}: {
		items: PageFeedItem[];
		matched: number;
		limit?: number;
		mode?: PageFeedMode;
	} = $props();

	const shown = $derived(items.slice(0, limit));
	const sections = $derived(mode === 'sections');

	// A section has no link of its own, so the useful things to see are which heading it came from
	// and how much text came with it — an empty one means the walk found nothing under the heading.
	function sectionNote(item: PageFeedItem): string {
		const anchor = item.url.includes('#') ? item.url.slice(item.url.indexOf('#')) : '';
		const size = item.content?.length ?? 0;
		return size ? `${anchor} · ${size.toLocaleString()} chars` : `${anchor} · empty`;
	}

	function formatDate(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

{#if items.length === 0}
	<p class="text-xs text-warning">
		{#if matched === 0}
			Nothing matches this selector. If the items are rendered by JavaScript, the feed won't see
			them either.
		{:else if sections}
			Matched {matched} heading{matched === 1 ? '' : 's'}, but none became a section — check the
			title pattern.
		{:else}
			Matched {matched} element{matched === 1 ? '' : 's'}, but found no linked, titled items in them.
		{/if}
	</p>
{:else}
	<p class="text-xs text-n-600">
		{items.length} item{items.length === 1 ? '' : 's'} found ({matched} element{matched === 1 ? '' : 's'} matched).
	</p>
	<ul class="max-h-64 divide-y divide-n-100 overflow-y-auto rounded-md border border-n-200">
		{#each shown as item (item.url)}
			<li class="flex gap-3 px-3 py-2">
				{#if sections}
					<!-- no thumbnail column: a section's images stay inside its own content -->
				{:else if item.image}
					<img src={item.image} alt="" loading="lazy" class="h-10 w-14 shrink-0 rounded object-cover bg-n-100" />
				{:else}
					<div class="h-10 w-14 shrink-0 rounded bg-n-100"></div>
				{/if}
				<div class="min-w-0 flex-1">
					<div class="truncate text-sm text-n-800">{item.title}</div>
					<div class="truncate text-xs text-n-500">
						{#if item.date}<span class="text-n-600">{formatDate(item.date)}</span>{#if item.summary} · {/if}{/if}{item.summary ?? ''}
					</div>
					<div class="truncate text-xs text-n-400">{sections ? sectionNote(item) : item.url}</div>
				</div>
			</li>
		{/each}
	</ul>
	{#if items.length > shown.length}
		<p class="text-xs text-n-400">…and {items.length - shown.length} more.</p>
	{/if}
{/if}
