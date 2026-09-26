<script lang="ts">
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { ArrowUp, Check } from 'lucide-svelte';
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

	const pill = 'h-8.5 flex items-center gap-1.75 rounded-full text-[13px] whitespace-nowrap';
	const whitePill =
		'bg-surface shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-n-900)_8%,transparent),0_6px_16px_-6px_color-mix(in_oklab,var(--color-n-900)_25%,transparent)]';
</script>

{#if !isFullView}
	<div class="absolute top-3 left-1/2 -translate-x-1/2 z-20">
		{#if refresh.refreshing}
			<div
				transition:fly={{ y: -8, duration: 150 }}
				class="{pill} {whitePill} pl-3 pr-3.5 font-medium text-n-700"
			>
				<div class="size-3.5 border-2 border-a-600 border-t-transparent rounded-full animate-spin"></div>
				Refreshing…
			</div>
		{:else if refresh.resultMessage}
			<!-- Accent only when there IS something new; "No new"/"Updated" read as a link in accent. -->
			{@const added = refresh.resultMessage.startsWith('+')}
			<div
				transition:fly={{ y: -8, duration: 150 }}
				class="{pill} {whitePill} px-3.5 font-semibold {added ? 'text-a-700' : 'text-n-700'}"
			>
				{#if added}
					<Check size={15} strokeWidth={2.5} />
				{/if}
				{refresh.resultMessage}
			</div>
		{:else if refresh.pendingNew > 0}
			<button
				transition:fly={{ y: -8, duration: 150 }}
				onclick={() => refresh.applyPending()}
				class="{pill} pl-2.75 pr-3.5 bg-a-600 text-on-accent font-semibold cursor-pointer transition-colors hover:bg-[color-mix(in_oklab,var(--color-a-600),black_14%)] shadow-[0_6px_16px_-4px_color-mix(in_oklab,var(--color-a-600)_50%,transparent),0_0_0_3px_color-mix(in_oklab,var(--color-surface)_90%,transparent)]"
			>
				<ArrowUp size={15} strokeWidth={2.5} />
				+{refresh.pendingNew} new
			</button>
		{/if}
	</div>
{/if}
