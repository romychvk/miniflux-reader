<script lang="ts">
	import { ui } from '$lib/stores/ui.svelte';
	import { X, ChevronLeft, ChevronRight } from 'lucide-svelte';

	function onKeydown(e: KeyboardEvent) {
		if (!ui.lightboxImage) return;
		if (e.key === 'Escape') ui.closeLightbox();
		else if (e.key === 'ArrowRight') ui.lightboxNext();
		else if (e.key === 'ArrowLeft') ui.lightboxPrev();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if ui.lightboxImage}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 cursor-zoom-out"
		onclick={() => ui.closeLightbox()}
		role="presentation"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<img
			src={ui.lightboxImage}
			alt=""
			class="max-h-full max-w-full object-contain select-none cursor-default"
			onclick={(e) => e.stopPropagation()}
		/>

		{#if ui.lightboxCount > 1}
			<button
				onclick={(e) => { e.stopPropagation(); ui.lightboxPrev(); }}
				class="fixed left-2 md:left-4 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/80 bg-black/40 hover:bg-black/60 hover:text-white"
				title="Previous (←)"
			>
				<ChevronLeft class="size-7" />
			</button>
			<button
				onclick={(e) => { e.stopPropagation(); ui.lightboxNext(); }}
				class="fixed right-2 md:right-4 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/80 bg-black/40 hover:bg-black/60 hover:text-white"
				title="Next (→)"
			>
				<ChevronRight class="size-7" />
			</button>
			<div
				class="fixed left-1/2 -translate-x-1/2 bottom-3 rounded-full px-3 py-1 text-sm text-white/90 bg-black/40 select-none"
			>
				{ui.lightboxIndex + 1} / {ui.lightboxCount}
			</div>
		{/if}

		<button
			onclick={(e) => { e.stopPropagation(); ui.closeLightbox(); }}
			class="fixed right-3 top-3 rounded-full p-2 text-white/80 bg-black/40 hover:bg-black/60 hover:text-white"
			title="Close (Esc)"
		>
			<X class="size-6" />
		</button>
	</div>
{/if}
