<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Entry } from '$lib/types';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { cardAspect } from '$lib/stores/cardAspect.svelte';
	import { relaTimestamp } from '$lib/time';
	import { makeEntrySlug } from '$lib/slug';
	import { getScrollDirection, addScrollTracker, removeScrollTracker } from '$lib/scroll';
	import ArticleView from './ArticleView.svelte';

	let { entry }: { entry: Entry } = $props();

	const feedIcon = $derived(feeds.findFeedNodeById(entry.feed.id, true)?.iconData);

	let rowEl: HTMLElement | undefined = $state();

	const isRead = $derived(entry.status === 'read');
	const isSelected = $derived(ui.selectedEntry?.id === entry.id);

	const viewMode = $derived(ui.viewMode);

	const thumbnailUrl = $derived(entry._thumbnailUrl ?? null);
	const description = $derived(entry._description ?? '');

	// Cards: size the image box to the current view's median thumbnail ratio, so a feed of
	// uniform images fills the box without bars or crop. Each loaded image feeds the median.
	const boxAspect = $derived(cardAspect.aspectFor(ui.viewKey));

	function recordAspect(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		if (img.naturalWidth && img.naturalHeight) {
			cardAspect.record(ui.viewKey, img.naturalWidth / img.naturalHeight);
		}
	}

	// In image-bearing views, fall back to the article's og:image when content + enclosure
	// gave us nothing. Lazy + cached in the store, so this is a no-op once resolved.
	$effect(() => {
		if ((viewMode === 'magazine' || viewMode === 'cards') && !thumbnailUrl) {
			entries.ensureThumbnail(entry);
		}
	});

	function toggleRead(e: MouseEvent) {
		e.stopPropagation();
		entries.markRead([entry.id], !isRead);
	}

	async function openArticle() {
		if (ui.isMobile || ui.layoutMode === 'two-column') {
			goto(`/article/${makeEntrySlug(entry.id, entry.title)}`);
			return;
		}
		// three-column or expanded: show inline / in the side panel
		if (ui.layoutMode === 'expanded' && isSelected) {
			ui.selectEntry(null); // clicking the open row collapses it
			return;
		}
		ui.selectEntry(entry);
		if (entry.status === 'unread') {
			entries.markRead([entry.id], true);
		}
		if (ui.layoutMode === 'expanded') {
			ui.suppressMarkRead();
			await tick();
			rowEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		}
	}

	// IntersectionObserver action for auto-mark-read
	function autoMarkRead(node: HTMLElement) {
		let prevInView = false;
		addScrollTracker();

		const observer = new IntersectionObserver(
			([e]) => {
				const inView = e.isIntersecting;
				if (!inView && prevInView && entry.status === 'unread' && getScrollDirection() === 'down' && ui.autoMarkReadOnScroll && !ui.isMarkReadSuppressed) {
					entries.markRead([entry.id], true);
				}
				prevInView = inView;
			},
			{ threshold: 0 }
		);
		observer.observe(node);

		return {
			destroy() {
				observer.disconnect();
				removeScrollTracker();
			}
		};
	}
</script>

{#if viewMode === 'list'}
	<!-- List: compact single-line rows, no images -->
	<div
		class="border-b border-n-100"
		bind:this={rowEl}
		use:autoMarkRead
	>
		<div
			class="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-n-200 {isSelected ? 'bg-a-50' : ''}"
			onclick={openArticle}
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Enter' && openArticle()}
		>
			<button
				type="button"
				onclick={toggleRead}
				aria-label={isRead ? 'Mark as unread' : 'Mark as read'}
				title={isRead ? 'Mark as unread' : 'Mark as read'}
				class="shrink-0 grid place-items-center size-5 rounded-full cursor-pointer group/dot"
			>
				{#if isRead}
					<span class="block size-4 group-hover/dot:size-[18px] rounded-full border-2 border-n-300 transition-[width,height] duration-150 ease-out"></span>
				{:else}
					<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-4 group-hover/dot:size-[18px] text-n-700 transition-[width,height] duration-150 ease-out">
						<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
						<circle cx="8" cy="8" r="3" fill="currentColor" />
					</svg>
				{/if}
			</button>

			{#if feedIcon}
				<img src={feedIcon} alt="" class="size-5 shrink-0" />
			{/if}

			<div class="flex-1 min-w-0 truncate">
				<span class="text-sm {isRead ? '' : 'font-bold'}">{entry.title}</span>
				{#if description}
					<span class="text-sm text-n-500">&nbsp;-&nbsp;{description}</span>
				{/if}
			</div>
			<span class="text-xs text-n-500 shrink-0">{entry.feed.title}</span>
			<span class="text-xs text-n-500 shrink-0">&middot;</span>
			<span class="text-xs text-n-500 shrink-0">{relaTimestamp(entry.published_at)}</span>
		</div>
	</div>

{:else if viewMode === 'magazine'}
	<!-- Magazine: image left, title/date/description right -->
	<div
		class="border-b border-n-100"
		bind:this={rowEl}
		use:autoMarkRead
	>
		<div
			class="flex items-start gap-4 px-4 py-3 cursor-pointer hover:bg-n-50 transition-colors {isSelected ? 'bg-a-50' : ''}"
			onclick={openArticle}
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Enter' && openArticle()}
		>
			<button
				type="button"
				onclick={toggleRead}
				aria-label={isRead ? 'Mark as unread' : 'Mark as read'}
				title={isRead ? 'Mark as unread' : 'Mark as read'}
				class="shrink-0 grid place-items-center size-5 mt-1 rounded-full cursor-pointer group/dot"
			>
				{#if isRead}
					<span class="block size-4 group-hover/dot:size-[18px] rounded-full border-2 border-n-300 transition-[width,height] duration-150 ease-out"></span>
				{:else}
					<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-4 group-hover/dot:size-[18px] text-n-700 transition-[width,height] duration-150 ease-out">
						<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
						<circle cx="8" cy="8" r="3" fill="currentColor" />
					</svg>
				{/if}
			</button>

			<div class="">

  	    <!-- <div class="flex-1 min-w-0 flex flex-col"> -->
  				<h3 class="leading-snug mb-2 font-bold {isRead ? 'text-n-500' : ''}">{entry.title}</h3>

          <div class="flex gap-4 justify-between">
            <div class="grow">
      				<p class="text-xs text-n-600 mb-2 flex items-center gap-2">
       					{#if feedIcon}
      						<img src={feedIcon} alt="" class="size-3 mt-px shrink-0 {isRead ? 'opacity-80' : ''}" />
       					{/if}
       					{entry.feed.title} &nbsp;&middot;&nbsp; {relaTimestamp(entry.published_at)}
      				</p>
      				{#if description}
       					<p class="text-sm leading-normal text-n-800 line-clamp-6">{description}</p>
      				{/if}
            </div>
            {#if thumbnailUrl}
      		    <div
      		    	class="shrink-0 w-56 mt-1 rounded overflow-hidden bg-n-100"
      		    	style="aspect-ratio: {boxAspect}"
      		    >
       					<img
        						src={thumbnailUrl}
        						alt=""
        						class="w-full h-full object-cover"
        						loading="lazy"
        						onload={recordAspect}
       					/>
        				<!-- {:else} -->
       					<!-- <div class="w-full h-full flex items-center justify-center text-n-300">
        						<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        						</svg>
       					</div> -->
      				</div>
       			{/if}

          </div>
  			<!-- </div> -->

			</div>




		</div>
	</div>

{:else}
	<!-- Cards: vertical card, image on top -->
	<div
		bind:this={rowEl}
		use:autoMarkRead
		class="rounded-lg border border-n-200 bg-surface overflow-hidden cursor-pointer hover:shadow-md transition-all {isRead ? 'opacity-60 bg-n-100 hover:bg-surface hover:opacity-100' : ''} {isSelected ? 'ring-2 ring-a-400' : ''}"
		onclick={openArticle}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Enter' && openArticle()}
	>


		{#if thumbnailUrl}
			<div
				class="relative w-full overflow-hidden bg-n-100 rounded-t-lg"
				style="aspect-ratio: {boxAspect}"
			>
				<!-- blurred backdrop: same image, enlarged + blurred to fill letterbox bars -->
				<img
					src={thumbnailUrl}
					alt=""
					aria-hidden="true"
					class="absolute inset-0 w-full h-full object-cover scale-110 blur brightness-70"
					loading="lazy"
				/>
				<!-- full image, never cropped; its real ratio tunes the box for this view -->
				<img
					src={thumbnailUrl}
					alt=""
					class="relative w-full h-full object-contain"
					loading="lazy"
					onload={recordAspect}
				/>
			</div>
		{/if}

		<div class="px-4 py-3">
  			<h3 class="leading-snug line-clamp-3 mb-2 {isRead ? 'font-normal' : 'font-bold'}">{entry.title}</h3>
			{#if description}
				<p class="text-sm text-n-800 leading-snug line-clamp-3 mb-3">{description}</p>
			{/if}
			<div class="flex justify-between gap-1">
   			<p class="text-xs text-n-500 flex items-center gap-2">
  				{#if feedIcon}
   					<img src={feedIcon} alt="" class="size-4 shrink-0 {isRead ? 'opacity-80' : ''} " />
  				{/if}
  				{entry.feed.title} &nbsp;&middot;&nbsp; {relaTimestamp(entry.published_at)}
   			</p>
        <button
     			type="button"
     			onclick={toggleRead}
     			aria-label={isRead ? 'Mark as unread' : 'Mark as read'}
     			title={isRead ? 'Mark as unread' : 'Mark as read'}
     			class="shrink-0 grid place-items-center size-6 rounded-full cursor-pointer bg-surface/70 backdrop-blur-sm group/dot"
    		>
     			{#if isRead}
    				<span class="block size-4 group-hover/dot:size-[18px] rounded-full border-2 border-n-400 transition-[width,height] duration-150 ease-out"></span>
     			{:else}
    				<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-4 group-hover/dot:size-[18px] text-n-700 transition-[width,height] duration-150 ease-out">
     					<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
     					<circle cx="8" cy="8" r="3" fill="currentColor" />
     				</svg>
     			{/if}
    		</button>
			</div>
		</div>
	</div>
{/if}

{#if ui.layoutMode === 'expanded' && isSelected && !ui.isMobile}
	<div class="{viewMode === 'cards' ? 'col-span-full' : 'border-b border-n-100'} bg-surface">
		<ArticleView {entry} onClose={() => ui.selectEntry(null)} />
	</div>
{/if}
