<script lang="ts">
	import { ui } from '$lib/stores/ui.svelte';
	import { resizable } from '$lib/actions/resize';
	import ArticleView from './ArticleView.svelte';
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
			<div class="flex-1 overflow-y-auto">
				<ArticleView entry={ui.selectedEntry} onClose={() => ui.selectEntry(null)} />
			</div>
		{/key}
	{:else}
		<div class="flex-1 flex items-center justify-center text-n-400 text-sm">
			Select an article to read
		</div>
	{/if}
</aside>
