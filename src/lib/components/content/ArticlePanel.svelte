<script lang="ts">
	import { ui } from '$lib/stores/ui.svelte';
	import { relaTimestamp } from '$lib/time';
	import EntryContent from './EntryContent.svelte';

	let resizing = $state(false);

	function onResizeStart(e: MouseEvent) {
		e.preventDefault();
		resizing = true;
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';
		const startX = e.clientX;
		const startWidth = ui.articlePanelWidth;

		function onMouseMove(e: MouseEvent) {
			ui.setArticlePanelWidth(startWidth - (e.clientX - startX));
		}

		function onMouseUp() {
			resizing = false;
			document.body.style.userSelect = '';
			document.body.style.cursor = '';
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		}

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}
</script>

<aside
	class="h-screen border-l border-n-200 bg-white flex flex-col shrink-0 relative"
	style="width: {ui.articlePanelWidth}px"
>
	<!-- Resize handle on left edge -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="absolute top-0 -left-1 w-2 h-full cursor-col-resize z-10 hover:bg-a-400/30 transition-colors {resizing ? 'bg-a-400/30' : ''}"
		onmousedown={onResizeStart}
	></div>

	{#if ui.selectedEntry}
		{#key ui.selectedEntry.id}
			<div class="flex-1 overflow-y-auto">
				<div class="max-w-3xl mx-auto px-4 py-4">
					<h1 class="text-3xl font-bold mb-3">
						<a href={ui.selectedEntry.url} target="_blank" rel="noopener noreferrer" class="hover:underline">{ui.selectedEntry.title}</a>
					</h1>

					<div class="flex items-center gap-2 text-sm text-n-500 mb-4">
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
