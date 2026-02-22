<script lang="ts">
	import { X } from 'lucide-svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { relaTimestamp } from '$lib/time';
	import { resizable } from '$lib/actions/resize';
	import EntryContent from './EntryContent.svelte';

	const feedIcon = $derived(ui.selectedEntry ? feeds.findFeedNodeById(ui.selectedEntry.feed.id, true)?.iconData : null);
</script>

<aside
	class="h-screen border-l border-n-200 bg-surface flex flex-col shrink-0 relative"
	style="width: {ui.articlePanelWidth}px"
>
	<!-- Resize handle on left edge -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="absolute top-0 -left-1 w-2 h-full cursor-col-resize z-10 hover:bg-a-400/30 transition-colors [&.active]:bg-a-400/30"
		use:resizable={{ getCurrentValue: () => ui.articlePanelWidth, onResize: ui.setArticlePanelWidth, invert: true }}
	></div>

	{#if ui.selectedEntry}
		{#key ui.selectedEntry.id}
			<div class="flex-1 overflow-y-auto relative">
				<button
					onclick={() => ui.selectEntry(null)}
					class="absolute top-3 right-3 p-1 rounded-md text-n-400 hover:text-n-700 hover:bg-n-100 transition-colors z-10"
					title="Close article"
				>
					<X size={18} />
				</button>
				<div class="max-w-3xl mx-auto px-8 py-6">
					<h1 class="text-3xl font-bold mb-3">
						<a href={ui.selectedEntry.url} target="_blank" rel="noopener noreferrer" class="hover:underline">{ui.selectedEntry.title}</a>
					</h1>

					<div class="flex items-center gap-2 text-sm text-n-500 mb-4">
						{#if feedIcon}
							<img src={feedIcon} alt="" class="size-5 shrink-0" />
						{/if}
						<span>{ui.selectedEntry.feed.title}</span>
						<span>&middot;</span>
						<span>{relaTimestamp(ui.selectedEntry.published_at)}</span>
						{#if ui.selectedEntry.author}
							<span>&middot;</span>
							<span>{ui.selectedEntry.author}</span>
						{/if}
					</div>

					<EntryContent entry={ui.selectedEntry} />
				</div>
			</div>
		{/key}
	{:else}
		<div class="flex-1 flex items-center justify-center text-n-400 text-sm">
			Select an article to read
		</div>
	{/if}
</aside>
