<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Entry } from '$lib/types';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { cardAspect } from '$lib/stores/cardAspect.svelte';
	import { relaTimestamp } from '$lib/time';
	import { entryLang } from '$lib/lang';
	import { makeEntrySlug } from '$lib/slug';
	import { autoMarkRead } from '$lib/autoMarkRead';
	import { Ban, Bookmark, Check, Circle } from 'lucide-svelte';
	import ArticleView from './ArticleView.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';

	let { entry }: { entry: Entry } = $props();

	const feedIcon = $derived(feeds.findFeedNodeById(entry.feed.id, true)?.iconData);

	// Carried only by the entry's own text (title + description). The feed name and the
	// relative timestamp around them are ours and stay in the document's language.
	const lang = $derived(entryLang(entry));

	let rowEl: HTMLElement | undefined = $state();

	const isRead = $derived(entry.status === 'read');
	const isStarred = $derived(entry.starred ?? false);
	const isSelected = $derived(ui.selectedEntry?.id === entry.id);

	let menu = $state<{ x: number; y: number } | null>(null);

	function openContextMenu(e: MouseEvent) {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY };
	}

	const menuItems = $derived([
		{
			label: 'Ignore posts like this…',
			icon: Ban,
			action: () =>
				ui.openFilterModal({ feedId: entry.feed.id, feedTitle: entry.feed.title, seedTitle: entry.title })
		},
		{
			label: isRead ? 'Mark as unread' : 'Mark as read',
			icon: isRead ? Circle : Check,
			action: () => entries.markRead([entry.id], !isRead)
		},
		{
			label: isStarred ? 'Remove bookmark' : 'Bookmark',
			icon: Bookmark,
			action: () => entries.toggleBookmark(entry.id)
		}
	]);

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

	function toggleBookmark(e: MouseEvent) {
		e.stopPropagation();
		entries.toggleBookmark(entry.id);
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

</script>

{#if viewMode === 'list'}
	<!-- List: compact single-line rows, no images -->
	<div
		class="border-b border-n-100"
		bind:this={rowEl}
		use:autoMarkRead={entry}
	>
		<div
			class="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-n-200 {isSelected ? 'bg-a-50' : ''}"
			onclick={openArticle}
			oncontextmenu={openContextMenu}
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

			<div class="flex-1 min-w-0 truncate" {lang}>
				<span class="text-sm {isRead ? '' : 'font-bold'}">{entry.title}</span>
				{#if description}
					<span class="text-sm text-n-500">&nbsp;-&nbsp;{description}</span>
				{/if}
			</div>
			<span class="text-xs text-n-500 shrink-0">{entry.feed.title}</span>
			<span class="text-xs text-n-500 shrink-0">&middot;</span>
			<span class="text-xs text-n-500 shrink-0">{relaTimestamp(entry.published_at)}</span>

			<button
				type="button"
				onclick={toggleBookmark}
				aria-label={isStarred ? 'Remove bookmark' : 'Bookmark'}
				title={isStarred ? 'Remove bookmark' : 'Bookmark'}
				class="shrink-0 grid place-items-center size-5 rounded-full cursor-pointer transition-colors {isStarred ? 'text-a-600' : 'text-n-400 hover:text-n-700'}"
			>
				<Bookmark size={16} fill={isStarred ? 'currentColor' : 'none'} />
			</button>
		</div>
	</div>

{:else if viewMode === 'magazine'}
	<!-- Magazine: image left, title/date/description right -->
	<div
		class="border-b border-n-200"
		bind:this={rowEl}
		use:autoMarkRead={entry}
	>
		<div
			class="flex items-start gap-4 px-4 py-3 @lg/mag:py-5 cursor-pointer hover:bg-n-50 transition-colors {isSelected ? 'bg-a-50' : ''}"
			onclick={openArticle}
			oncontextmenu={openContextMenu}
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Enter' && openArticle()}
		>
			<div class="shrink-0 flex flex-col items-center gap-2 mt-1">
				<button
					type="button"
					onclick={toggleRead}
					aria-label={isRead ? 'Mark as unread' : 'Mark as read'}
					title={isRead ? 'Mark as unread' : 'Mark as read'}
					class="grid place-items-center size-5 rounded-full cursor-pointer group/dot"
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
				<button
					type="button"
					onclick={toggleBookmark}
					aria-label={isStarred ? 'Remove bookmark' : 'Bookmark'}
					title={isStarred ? 'Remove bookmark' : 'Bookmark'}
					class="grid place-items-center size-5 rounded-full cursor-pointer transition-colors {isStarred ? 'text-a-600' : 'text-n-400 hover:text-n-700'}"
				>
					<Bookmark size={16} fill={isStarred ? 'currentColor' : 'none'} />
				</button>
			</div>

			<div class="flex-1 min-w-0">

  		  <h3 class="leading-snug mb-2 font-bold @lg/mag:text-lg {isRead ? 'text-n-500' : ''}" {lang}>{entry.title}</h3>
        <p class="text-xs @lg/mag:text-sm text-n-600 mb-2 @lg/mag:mb-3 flex items-center gap-2">
   					{#if feedIcon}
  						<img src={feedIcon} alt="" class="size-3 mt-px shrink-0 {isRead ? 'opacity-80' : ''}" />
   					{/if}
   					{entry.feed.title} &nbsp;&middot;&nbsp; {relaTimestamp(entry.published_at)}
  				</p>

          <div class="grow flex gap-4 @lg/mag:gap-6 w-full justify-between">
            {#if thumbnailUrl}
      		    <div
      		    	class="relative self-start shrink-0 w-56 @lg/mag:w-64 max-h-[150px] @lg/mag:max-h-[240px] mt-1 rounded overflow-hidden bg-n-100 flex items-center justify-center"
      		    >
       					<!-- blurred backdrop: only fills the side gaps of a portrait image; a full-width
       					     landscape image covers it entirely, so no top/bottom bars ever show -->
       					<img
        						src={thumbnailUrl}
        						alt=""
        						aria-hidden="true"
        						class="absolute inset-0 w-full h-full object-cover scale-110 blur brightness-70"
        						loading="lazy"
       					/>
       					<!-- full image, never cropped; width caps at 224px (w-56), height caps at 150px so
       					     tall images stay compact and the box hugs the rendered image height -->
       					<img
        						src={thumbnailUrl}
        						alt=""
        						class="relative block max-h-[150px] @lg/mag:max-h-[240px] max-w-full w-auto"
        						loading="lazy"
       					/>
      				</div>
       			{/if}
            <div class="grow">

      				{#if description}
       					<p class="text-sm @lg/mag:text-base leading-normal text-n-800 line-clamp-6" {lang}>{description}</p>
      				{/if}
            </div>

          </div>
			</div>




		</div>
	</div>

{:else}
	<!-- Cards: vertical card, image on top -->
	<div
		bind:this={rowEl}
		use:autoMarkRead={entry}
		class="rounded-lg border border-n-200 bg-surface overflow-hidden cursor-pointer hover:shadow-md transition-all {isRead ? 'opacity-60 bg-n-100 hover:bg-surface hover:opacity-100' : ''} {isSelected ? 'ring-2 ring-a-400' : ''}"
		onclick={openArticle}
		oncontextmenu={openContextMenu}
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
  			<h3 class="leading-snug line-clamp-3 mb-2 {isRead ? 'font-normal' : 'font-bold'}" {lang}>{entry.title}</h3>
			{#if description}
				<p class="text-sm text-n-800 leading-snug line-clamp-3 mb-3" {lang}>{description}</p>
			{/if}
			<div class="flex justify-between gap-1">
   			<p class="text-xs text-n-500 flex items-center gap-2">
  				{#if feedIcon}
   					<img src={feedIcon} alt="" class="size-4 shrink-0 {isRead ? 'opacity-80' : ''} " />
  				{/if}
  				{entry.feed.title} &nbsp;&middot;&nbsp; {relaTimestamp(entry.published_at)}
   			</p>
				<div class="shrink-0 flex items-center gap-1">
					<button
						type="button"
						onclick={toggleBookmark}
						aria-label={isStarred ? 'Remove bookmark' : 'Bookmark'}
						title={isStarred ? 'Remove bookmark' : 'Bookmark'}
						class="shrink-0 grid place-items-center size-6 rounded-full cursor-pointer bg-surface/70 backdrop-blur-sm transition-colors {isStarred ? 'text-a-600' : 'text-n-500 hover:text-n-800'}"
					>
						<Bookmark size={16} fill={isStarred ? 'currentColor' : 'none'} />
					</button>
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
	</div>
{/if}

{#if ui.layoutMode === 'expanded' && isSelected && !ui.isMobile}
	<div class="{viewMode === 'cards' ? 'col-span-full' : 'border-b border-n-100'} bg-surface">
		<ArticleView {entry} onClose={() => ui.selectEntry(null)} />
	</div>
{/if}

{#if menu}
	<ContextMenu x={menu.x} y={menu.y} items={menuItems} onclose={() => (menu = null)} />
{/if}
