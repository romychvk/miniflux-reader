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
		// Zen is a placement of its own, so it routes full-page exactly like two-column. A split
		// pane mode always opens its own placement — reaching Zen from there is the reader's
		// explicit call, via the button in the article's action row.
		if (ui.isMobile || ui.layoutMode === 'two-column' || ui.layoutMode === 'zen') {
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

	// Cards hover-expand: the hovered card grows out of its cell in every direction — a little
	// into the gutters at the sides and top, and as far down as the fuller title and description
	// need. The cell keeps the collapsed footprint, so the grid never reflows. The picture grows
	// with the card, but the text column does not: the body's side padding takes back exactly what
	// the card gains, so a grown card reads as more air around the same lines rather than as wider
	// ones, with a little extra room under the text.
	//
	// How far the card rises isn't a constant: the wider picture is also a taller one, so the card
	// lifts by exactly what the picture gained (measured, see grow()). The seam between picture and
	// title then holds its line and only the card's own edges move. A card without a picture has
	// nothing to gain, so it stays put at the top.
	const GROW_X = 10; // px the card bleeds past its cell to the left and right
	const GROW_B = 6; // px of extra room below the text
	const PAD_X = 16; // the body's resting px-4 …
	const PAD_B = 12; // … and the bottom half of its py-3
	const GROW_MS = 180;

	let cardEl: HTMLElement | undefined = $state();
	let bodyEl: HTMLElement | undefined = $state();
	let imageEl: HTMLElement | undefined = $state();
	let expanded = $state(false);
	let frozenHeight = $state(0);
	let frozenImageHeight = 0;
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	// Not on touch (no real hover), and not for the card whose article is open inline —
	// that one would grow over its own ArticleView.
	const canExpand = $derived(
		viewMode === 'cards' && !ui.isMobile && !(ui.layoutMode === 'expanded' && isSelected)
	);

	type Rect = { left: string; right: string; top: string; height: string };
	type Pad = { x: string; b: string };

	const cellRect = (): Rect => ({ left: '0px', right: '0px', top: '0px', height: `${frozenHeight}px` });
	const cellPad = (): Pad => ({ x: `${PAD_X}px`, b: `${PAD_B}px` });
	const grownPad = (): Pad => ({ x: `${PAD_X + GROW_X}px`, b: `${PAD_B + GROW_B}px` });

	// Where the card sits right now, in the terms we animate — mid-flight values while a previous
	// grow or shrink is still running, so a reversal picks up from there, not from scratch.
	function currentRect(el: HTMLElement): Rect {
		const cell = el.parentElement as HTMLElement;
		return {
			left: `${el.offsetLeft}px`,
			right: `${cell.clientWidth - el.offsetLeft - el.offsetWidth}px`,
			top: `${el.offsetTop}px`,
			height: `${el.offsetHeight}px`
		};
	}

	function currentPad(el: HTMLElement): Pad {
		const cs = getComputedStyle(el);
		return { x: cs.paddingLeft, b: cs.paddingBottom };
	}

	function setRect(el: HTMLElement, r: Rect) {
		el.style.left = r.left;
		el.style.right = r.right;
		el.style.top = r.top;
		el.style.height = r.height;
	}

	function setPad(el: HTMLElement, p: Pad) {
		el.style.paddingLeft = p.x;
		el.style.paddingRight = p.x;
		el.style.paddingBottom = p.b;
	}

	function resetCardStyle() {
		if (cardEl) cardEl.style.cssText = '';
		if (bodyEl) bodyEl.style.cssText = '';
	}

	// Readers who asked for less motion get the same growth, just without the travel. Card and
	// body share the duration and easing, so the text column holds one width the whole way: the
	// card widens by exactly what the padding gives back, frame for frame.
	const RECT_PROPS = ['left', 'right', 'top', 'height'];
	const PAD_PROPS = ['padding-left', 'padding-right', 'padding-bottom'];

	const ease = (kind: string, props: string[]) => {
		const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : GROW_MS;
		return props.map((p) => `${p} ${ms}ms ${kind}`).join(', ');
	};

	async function grow() {
		if (!cardEl || !canExpand) return;
		const fresh = !expanded;
		if (fresh) {
			frozenHeight = cardEl.offsetHeight; // the cell's footprint, taken before we leave the flow
			frozenImageHeight = imageEl?.getBoundingClientRect().height ?? 0;
			expanded = true;
			await tick(); // the card is absolute now, but has no geometry until we give it one
		}
		const el = cardEl;
		const body = bodyEl;
		if (!el || !body || !expanded) return;
		const fromRect = fresh ? cellRect() : currentRect(el);
		const fromPad = fresh ? cellPad() : currentPad(body);
		// Widen the card first: that alone gives the picture its grown height, and the difference is
		// how far the card has to rise for the seam under the picture to stay on its line.
		el.style.transition = 'none';
		body.style.transition = 'none';
		setPad(body, grownPad());
		setRect(el, { left: `${-GROW_X}px`, right: `${-GROW_X}px`, top: '0px', height: 'auto' });
		const rise = (imageEl?.getBoundingClientRect().height ?? 0) - frozenImageHeight;
		const grown = { left: `${-GROW_X}px`, right: `${-GROW_X}px`, top: `${-rise}px` };
		// An auto height can't animate either, so measure the one the grown card wants, padding and all…
		setRect(el, { ...grown, height: 'auto' });
		const toRect = { ...grown, height: `${el.getBoundingClientRect().height}px` };
		// …then play it from where we are.
		setRect(el, fromRect);
		setPad(body, fromPad);
		void el.offsetHeight; // reflow, so the growth animates instead of jumping
		el.style.transition = ease('ease-out', RECT_PROPS);
		body.style.transition = ease('ease-out', PAD_PROPS);
		setRect(el, toRect);
		setPad(body, grownPad());
		// Hand the height back to the content once the growth has played.
		settleTimer = setTimeout(() => {
			el.style.transition = '';
			body.style.transition = '';
			el.style.height = 'auto';
		}, GROW_MS + 30);
	}

	function shrink() {
		const el = cardEl;
		const body = bodyEl;
		if (!el || !body || !expanded) {
			expanded = false;
			return;
		}
		el.style.transition = 'none';
		body.style.transition = 'none';
		setRect(el, currentRect(el));
		setPad(body, currentPad(body));
		void el.offsetHeight;
		el.style.transition = ease('ease-in', RECT_PROPS);
		body.style.transition = ease('ease-in', PAD_PROPS);
		setRect(el, cellRect());
		setPad(body, cellPad());
		// The card ends the shrink exactly on its cell rect, so dropping back into the flow there
		// is invisible.
		settleTimer = setTimeout(() => {
			expanded = false;
			resetCardStyle();
		}, GROW_MS + 20);
	}

	function hoverEnter() {
		if (!canExpand) return;
		clearTimeout(hoverTimer);
		clearTimeout(settleTimer);
		// Short hover-intent delay, so cards don't pop while the pointer crosses the grid.
		hoverTimer = setTimeout(grow, 120);
	}

	function hoverLeave() {
		clearTimeout(hoverTimer);
		clearTimeout(settleTimer);
		shrink();
	}

	$effect(() => () => {
		clearTimeout(hoverTimer);
		clearTimeout(settleTimer);
	});

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
		class="relative"
		style={expanded ? `height: ${frozenHeight}px` : ''}
	>
	<div
		bind:this={cardEl}
		onmouseenter={hoverEnter}
		onmouseleave={hoverLeave}
		class="rounded-lg border border-n-200 bg-surface overflow-hidden cursor-pointer hover:shadow-md transition-all {isRead ? 'opacity-60 bg-n-100 hover:bg-surface hover:opacity-100' : ''} {isSelected ? 'ring-2 ring-a-400' : ''} {expanded ? 'absolute z-20 shadow-xl' : ''}"
		onclick={openArticle}
		oncontextmenu={openContextMenu}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Enter' && openArticle()}
	>


		{#if thumbnailUrl}
			<div
				bind:this={imageEl}
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

		<div bind:this={bodyEl} class="px-4 py-3">
  			<h3 class="leading-snug {expanded ? 'line-clamp-none' : 'line-clamp-3'} mb-2 {isRead ? 'font-normal' : 'font-bold'}" {lang}>{entry.title}</h3>
			{#if description}
				<p class="text-sm text-n-800 leading-snug {expanded ? 'line-clamp-8' : 'line-clamp-3'} mb-3" {lang}>{description}</p>
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
