<script lang="ts">
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { refresh } from '$lib/stores/refresh.svelte';
	import { ui } from '$lib/stores/ui.svelte';

	// Same full-view test as the layout: reading/settings views get no pills. The
	// pending chip survives in the store and reappears back on the list view.
	const isFullView = $derived(
		(page.route.id?.includes('/article/') || page.route.id?.includes('/settings')) ?? false
	);

	// A result or chip belongs to the context it was computed for — drop both when
	// the selection changes (prev-key pattern, same as TopBar's search reset).
	let prevKey: string | undefined;
	$effect(() => {
		const sel = ui.selectedFeed;
		const key = sel ? `${sel.isFeed}:${sel.id}` : '';
		if (prevKey !== undefined && key !== prevKey) refresh.onSelectionChanged();
		prevKey = key;
	});
</script>

{#if !isFullView}
	<div class="absolute top-3 left-1/2 -translate-x-1/2 z-20">
		{#if refresh.refreshing}
			<div
				transition:fly={{ y: -8, duration: 150 }}
				class="flex items-center gap-2.5 bg-surface border border-n-200 rounded-full shadow-lg px-4 py-2 text-sm text-n-700"
			>
				<div class="h-4 w-4 border-2 border-a-500 border-t-transparent rounded-full animate-spin"></div>
				Refreshing…
			</div>
		{:else if refresh.resultMessage}
			<!-- Accent only when there IS something new; "No new"/"Updated" read as a link in accent. -->
			<div
				transition:fly={{ y: -8, duration: 150 }}
				class="bg-surface border border-n-200 rounded-full shadow-lg px-4 py-2 text-base font-medium {refresh.resultMessage.startsWith('+') ? 'text-a-700' : 'text-n-700'}"
			>
				{refresh.resultMessage}
			</div>
		{:else if refresh.pendingNew > 0}
			<button
				transition:fly={{ y: -8, duration: 150 }}
				onclick={() => refresh.applyPending()}
				class="bg-a-600 text-on-accent hover:bg-a-700 rounded-full shadow-lg px-4 py-2 text-base font-medium cursor-pointer transition-colors"
			>
				+{refresh.pendingNew} new
			</button>
		{/if}
	</div>
{/if}
