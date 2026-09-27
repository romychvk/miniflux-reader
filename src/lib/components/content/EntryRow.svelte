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
	import { archivedSrc } from '$lib/imageArchive';
	import { Ban, Bookmark, Check, Circle, SquareArrowOutUpRight } from 'lucide-svelte';
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
			// Right-clicking a row opens this menu instead of the browser's, so the entry it would
			// have offered — open link in a new tab — has to be here too. Same destination as the
			// middle click: the article alone, in Zen.
			label: 'Open in new tab',
			icon: SquareArrowOutUpRight,
			action: () => {
				window.open(articleHref, '_blank', 'noopener');
				openedElsewhere();
			}
		},
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

	// Where the card's picture comes from, in order of preference. With archiving on for the feed
	// we ask our own copy first and keep the source as the fallback for anything not downloaded
	// yet; otherwise the source is all there is.
	const thumbnailChain = $derived.by(() => {
		const url = entry._thumbnailUrl ?? null;
		if (!url) return [] as string[];
		return entry._archiveImages ? [archivedSrc(url), url] : [url];
	});

	// A source can refuse to serve its images to a third-party page — hotlink protection, or a bot
	// challenge answering a cross-origin <img> with a 403 challenge page (mezha.ua's CDN does this).
	// The browser then paints its broken-image glyph inside an otherwise finished card. When the
	// whole chain has failed, treat it as "no thumbnail" so the card falls back to the text-only
	// layout it already has. The tally is keyed by the chain's head, so a thumbnail that arrives
	// later (ensureThumbnail's og:image) starts its own attempts rather than inheriting a verdict.
	let failed = $state({ key: '', count: 0 });
	const thumbnailUrl = $derived.by(() => {
		const chain = thumbnailChain;
		if (chain.length === 0) return null;
		return chain[failed.key === chain[0] ? failed.count : 0] ?? null;
	});
	const description = $derived(entry._description ?? '');
	// The summary carries the post's own breaks (see extractDescription): a blank line between
	// paragraphs, a single one inside them. A card with no picture has the room to lay that out the
	// way the article itself reads — the paragraphs here, the line breaks in whitespace-pre-line —
	// while everywhere else the text stays in one element and the browser collapses it to spaces.
	const paragraphs = $derived(description.split(/\n{2,}/).filter((p) => p !== ''));

	function thumbnailFailed() {
		const key = thumbnailChain[0] ?? '';
		failed = { key, count: (failed.key === key ? failed.count : 0) + 1 };
	}

	// Cards: size the image box to the current view's median thumbnail ratio, so a feed of
	// uniform images fills the box without bars or crop. Each loaded image feeds the median.
	const boxAspect = $derived(cardAspect.aspectFor(ui.viewKey));

	// How much of the card the text of a picture-less one gets, in the terms a card *with* a
	// picture sets. At least the three lines of summary a picture card shows, so a feed of one-line
	// release notes ("Bug fixes and improvements.") still reads as cards and not as strips. At most
	// the image box — the card's own width over this view's ratio, hence the card being the
	// container the cqw resolves against — plus two more lines: two rather than three, because the
	// rest of a text-only card is not identical either (its title is free to run the longer of its
	// three clamped lines), and a card that ends up taller sets the height of every row it is in.
	const LINE = 1.375 * 0.875; // rem of one summary line: text-sm at leading-snug
	const MIN_LINES = 3;
	const MAX_EXTRA_LINES = 2;
	const textOnlyStyle = $derived(
		`min-height: ${(MIN_LINES * LINE).toFixed(3)}rem; ` +
			`max-height: calc(100cqw / ${boxAspect} + ${(MAX_EXTRA_LINES * LINE).toFixed(3)}rem)`
	);

	// Text that runs past that bound fades into the card at the bottom edge, where a hard cut would
	// read as a rendering bug. Only then, though: the gradient reaches ~1.5 lines up, so painted
	// over a summary that already fits it just washes out its last line — which is most of them in
	// a short-note feed. Hence the measurement, and the observer for every reason the box can
	// change size: the window, the row's tallest card, a picture arriving late.
	const FADE_OUT = 'mask-image: linear-gradient(to bottom, #000 calc(100% - 1.75rem), transparent)';
	let textEl: HTMLElement | undefined = $state();
	let clipped = $state(false);
	$effect(() => {
		const el = textEl;
		if (!el) return;
		const measure = () => (clipped = el.scrollHeight - el.clientHeight > 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});

	function recordAspect(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		if (img.naturalWidth && img.naturalHeight) {
			cardAspect.record(ui.viewKey, img.naturalWidth / img.naturalHeight);
		}
	}

	// In image-bearing views, fall back to the article's og:image when content + enclosure
	// gave us nothing. Lazy + cached in the store, so this is a no-op once resolved.
	$effect(() => {
		// the raw value, not the broken-filtered one: a blocked image means the whole host is
		// unreachable to us, so chasing its og:image would only add another failing request
		if ((viewMode === 'magazine' || viewMode === 'cards') && !entry._thumbnailUrl) {
			entries.ensureThumbnail(entry);
		}
	});

	function toggleRead(e: MouseEvent) {
		e.preventDefault(); // the row is a link now — the button's click must not follow it
		e.stopPropagation();
		entries.markRead([entry.id], !isRead);
	}

	function toggleBookmark(e: MouseEvent) {
		e.preventDefault();
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

	// The row is a real link, so the browser's own open-in-a-new-tab gestures work on it: middle
	// click, Ctrl/⌘+click, dragging it to the tab bar. Such a tab has no app around the article —
	// no list to come back to, no pane to sit beside — so the link asks for Zen, which is exactly
	// that reading: the article alone. A plain left click never travels through this href; it is
	// ours, and openArticle() places the article the reader's pane mode says it goes.
	const articleHref = $derived(`/article/${makeEntrySlug(entry.id, entry.title)}?zen=1`);

	function openInPlace(e: MouseEvent) {
		// A modified click belongs to the browser: new tab, new window, download. Only the first two
		// actually open the article — alt+click downloads the page and never reads it.
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
			if (e.metaKey || e.ctrlKey || e.shiftKey) openedElsewhere();
			return;
		}
		e.preventDefault();
		openArticle();
	}

	function onAuxClick(e: MouseEvent) {
		if (e.button !== 1) return;
		// Middle-clicking one of the row's own buttons must not also open the article in a tab: the
		// auxclick bubbles to the link, and cancelling it here is what stops the link activating.
		if ((e.target as HTMLElement).closest('button')) {
			e.preventDefault();
			return;
		}
		openedElsewhere();
	}

	// The tab we just handed the article to marks it read as it loads. Mark it here as well, or
	// this list sits on a card that still reads unread — opening an article is what marks it read
	// in this reader, and which window it opened in doesn't change that.
	function openedElsewhere() {
		if (entry.status === 'unread') entries.markRead([entry.id], true);
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
	const BOTTOM_AIR = 16; // px of scroll room kept under a grown card in the last row
	const PAD_X = 14; // the body's resting px-3.5 …
	const PAD_B = 10; // … and the bottom half of its py-2.5
	const GROW_MS = 180;
	const HOVER_MS = 300; // hover-intent: how long the pointer has to settle before a card grows

	let cardEl: HTMLElement | undefined = $state();
	let bodyEl: HTMLElement | undefined = $state();
	let imageEl: HTMLElement | undefined = $state();
	let expanded = $state(false);
	let frozenHeight = $state(0);
	let frozenImageHeight = 0;
	let bottomReach = $state(0);
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	// Not on touch (no real hover), and not for the card whose article is open inline — that one
	// would grow over its own ArticleView. A card with no picture doesn't grow either: it already
	// stands the full height of its row and spends all of it on the text, so a wider card would
	// reveal nothing (and the rise a grown card measures is the picture's, which it hasn't got).
	const canExpand = $derived(
		viewMode === 'cards' && !!thumbnailUrl && !ui.isMobile && !(ui.layoutMode === 'expanded' && isSelected)
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
		// A card stretched to a taller neighbour's row height may hold less than it stands: never let
		// the grown card end above the bottom of its cell.
		el.style.minHeight = `${frozenHeight + rise}px`;
		setRect(el, { ...grown, height: 'auto' });
		const grownHeight = el.getBoundingClientRect().height;
		const toRect = { ...grown, height: `${grownHeight}px` };
		// How far below the cell the grown card will reach, plus the air we want under it (see the
		// spacer in the markup).
		bottomReach = grownHeight - rise + BOTTOM_AIR;
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

	// How tall the spacer has to stay, measured from the cell's top down to the bottom edge of
	// the scrolled view. Zero (no spacer) once the view no longer reaches past the cell.
	function keptReach(el: HTMLElement): number {
		const cell = el.parentElement;
		const sc = cell?.closest('main');
		if (!cell || !sc) return 0;
		const cellTop = cell.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
		return Math.max(0, sc.scrollTop + sc.clientHeight - cellTop);
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
		el.style.minHeight = ''; // the height is pinned now; the floor would stop it reaching the cell
		setPad(body, currentPad(body));
		void el.offsetHeight;
		el.style.transition = ease('ease-in', RECT_PROPS);
		body.style.transition = ease('ease-in', PAD_PROPS);
		setRect(el, cellRect());
		setPad(body, cellPad());
		// The card ends the shrink exactly on its cell rect, so dropping back into the flow there
		// is invisible.
		settleTimer = setTimeout(() => {
			// Losing the card's overflow shortens the scroll, and a reader who had scrolled down into
			// that room would be yanked back up. Leave the spacer standing exactly as far as the
			// bottom of the view, in the same update that puts the card back: that holds the current
			// position, and costs nothing when the view had not gone past the list's own end — there
			// the spacer stops short of content that is already there.
			bottomReach = keptReach(el);
			expanded = false;
			resetCardStyle();
		}, GROW_MS + 20);
	}

	function hoverEnter() {
		if (!canExpand) return;
		clearTimeout(hoverTimer);
		clearTimeout(settleTimer);
		// A card only grows once the pointer has actually stopped on it — sweeping across the grid
		// leaves every card it passes over untouched.
		hoverTimer = setTimeout(grow, HOVER_MS);
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

<!-- The same two actions in every view: Bookmark, then Mark as read. `hot` lends them the hover
     colour while a card is grown (the pointer is on it). -->
{#snippet actions(hot: boolean)}
	<div class="shrink-0 flex items-center gap-0.5">
		<button
			type="button"
			onclick={toggleBookmark}
			aria-label={isStarred ? 'Remove bookmark' : 'Bookmark'}
			title={isStarred ? 'Remove bookmark' : 'Bookmark'}
			class="grid place-items-center size-6 rounded-full cursor-pointer transition-colors hover:bg-a-50 hover:text-a-700 {isStarred || hot ? 'text-a-700' : 'text-n-400/80'}"
		>
			<Bookmark size={15} fill={isStarred ? 'currentColor' : 'none'} />
		</button>
		<button
			type="button"
			onclick={toggleRead}
			aria-label={isRead ? 'Mark as unread' : 'Mark as read'}
			title={isRead ? 'Mark as unread' : 'Mark as read'}
			class="grid place-items-center size-6 rounded-full cursor-pointer transition-colors hover:bg-a-50 hover:text-a-700 {hot ? 'text-a-700' : isRead ? 'text-n-400/80' : 'text-n-500'}"
		>
			{#if isRead}
				<span class="block size-4 rounded-full border-[1.5px] border-current"></span>
			{:else}
				<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-4">
					<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
					<circle cx="8" cy="8" r="3" fill="currentColor" />
				</svg>
			{/if}
		</button>
	</div>
{/snippet}

<!-- The footer a card ends on (Cards, Magazine): feed · time on the left, the actions right. -->
{#snippet actionFooter(hot: boolean)}
	<div class="flex justify-between items-center gap-1.5 pt-2 border-t border-n-200/60 mt-auto">
		<p class="min-w-0 text-xs text-n-500 flex items-center gap-1.5">
			{#if feedIcon}
				<img src={feedIcon} alt="" class="size-4 rounded-[4px] shrink-0" />
			{/if}
			<span class="truncate">{entry.feed.title}</span>
			<span class="shrink-0">&middot;</span>
			<span class="shrink-0">{relaTimestamp(entry.published_at)}</span>
		</p>
		{@render actions(hot)}
	</div>
{/snippet}

{#if viewMode === 'list'}
	<!-- List: one-line rows on a shared sheet (EntryList). The card footer folds into a trailing
	     cluster; the divider is a 1px shadow, which the sheet's overflow clips under the last row. -->
	<div bind:this={rowEl} use:autoMarkRead={entry}>
		<a
			href={articleHref}
			class="flex items-center gap-3 h-11 pl-4 pr-2.5 cursor-pointer shadow-[0_1px_0_var(--color-n-200)] transition-[opacity,background-color] hover:bg-n-50 {isSelected ? 'bg-a-50' : ''} {isRead ? 'opacity-55 hover:opacity-100' : ''}"
			onclick={openInPlace}
			onauxclick={onAuxClick}
			oncontextmenu={openContextMenu}
		>
			{#if feedIcon}
				<img src={feedIcon} alt="" class="size-4 rounded-[4px] shrink-0" />
			{/if}

			<div class="flex-1 min-w-0 truncate text-sm leading-5" {lang}>
				<span class="tracking-[-0.005em] {isRead ? 'font-medium' : 'font-[650]'}">{entry.title}</span>
				{#if description}
					<span class="text-n-300 mx-2">—</span>
					<span class="text-n-500">{description}</span>
				{/if}
			</div>
			<span class="shrink-0 hidden @lg:flex items-center gap-1.5 text-xs text-n-500">
				<span>{entry.feed.title}</span>
				<span>&middot;</span>
				<span class="min-w-6 text-right tabular-nums">{relaTimestamp(entry.published_at)}</span>
			</span>
			<div class="ml-1 shrink-0">
				{@render actions(false)}
			</div>
		</a>
	</div>

{:else if viewMode === 'magazine'}
	<!-- Magazine: a card with the picture down its left side (full height, contained over its own
	     blurred copy, as in Cards) and the Cards footer at the foot of the text. Without a picture
	     the text takes the whole width and the summary two more lines. -->
	<div class="@container/mag h-full" bind:this={rowEl} use:autoMarkRead={entry}>
		<a
			href={articleHref}
			class="flex h-full rounded-xl bg-surface overflow-hidden cursor-pointer transition-[opacity,box-shadow] duration-150 {isRead ? 'opacity-55 hover:opacity-100' : ''} {isSelected ? 'shadow-[0_0_0_2px_var(--color-a-500)]' : 'shadow-card hover:shadow-card-hover'}"
			onclick={openInPlace}
			onauxclick={onAuxClick}
			oncontextmenu={openContextMenu}
		>
			{#if thumbnailUrl}
				<div class="relative w-60 shrink-0 self-stretch overflow-hidden bg-n-100 hidden @md/mag:block">
					<img
						src={thumbnailUrl}
						alt=""
						aria-hidden="true"
						class="absolute inset-0 w-full h-full object-cover scale-110 blur brightness-70"
						loading="lazy"
					/>
					<img
						src={thumbnailUrl}
						alt=""
						class="absolute inset-0 w-full h-full object-contain"
						loading="lazy"
						onerror={thumbnailFailed}
					/>
				</div>
			{/if}

			<div class="px-4 pt-3 pb-2.5 flex-1 min-w-0 flex flex-col">
				<h3 class="text-[16px] leading-[1.35] tracking-[-0.005em] font-[650] line-clamp-3 mb-1.5" {lang}>{entry.title}</h3>
				{#if description}
					<p class="text-[13px] text-n-600 leading-[1.45] mb-2.5 {thumbnailUrl ? 'line-clamp-2' : 'line-clamp-4'}" {lang}>{description}</p>
				{/if}
				{@render actionFooter(false)}
			</div>
		</a>
	</div>
{:else}
	<!-- Cards: vertical card, image on top -->
	<div
		bind:this={rowEl}
		use:autoMarkRead={entry}
		class="relative"
		style={expanded ? `height: ${frozenHeight}px` : ''}
	>
	<a
		bind:this={cardEl}
		href={articleHref}
		onmouseenter={hoverEnter}
		onmouseleave={hoverLeave}
		class="flex flex-col h-full {thumbnailUrl ? '' : '@container'} rounded-xl bg-surface overflow-hidden cursor-pointer transition-[opacity,box-shadow] {isRead && !expanded ? 'opacity-55 hover:opacity-100' : ''} {isSelected ? 'shadow-[0_0_0_2px_var(--color-a-500)]' : expanded ? 'shadow-card-grown' : 'shadow-card'} {expanded ? 'absolute z-20' : ''}"
		onclick={openInPlace}
		onauxclick={onAuxClick}
		oncontextmenu={openContextMenu}
	>


		{#if thumbnailUrl}
			<div
				bind:this={imageEl}
				class="relative w-full shrink-0 overflow-hidden bg-n-100"
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
					onerror={thumbnailFailed}
				/>
			</div>
		{/if}

		<!-- Every card stands its row's full height (h-full above), so a row reads as one height and
		     the byline sits at the foot of each card. With no picture the text column takes the room
		     the picture would have had (see textOnlyStyle) and no more. Beside a picture the summary is
		     clamped to three lines, eight while the card is grown. -->
		<div bind:this={bodyEl} class="px-3.5 py-2.5 flex-1 flex flex-col {thumbnailUrl ? '' : 'min-h-0'}">
			<h3 class="text-[15px] leading-[1.35] tracking-[-0.005em] {expanded ? 'line-clamp-none' : 'line-clamp-3'} mb-1.5 font-[650]" {lang}>{entry.title}</h3>
			{#if description}
				{#if thumbnailUrl}
					<p
						class="text-[13px] text-n-600 leading-[1.45] mb-2.5 {expanded ? 'line-clamp-8' : 'line-clamp-3'}"
						{lang}>{description}</p>
				{:else}
					<div
						bind:this={textEl}
						class="text-[13px] text-n-600 leading-[1.45] mb-2.5 flex-1 overflow-hidden"
						style={clipped ? `${textOnlyStyle}; ${FADE_OUT}` : textOnlyStyle}
						{lang}
					>
						{#each paragraphs as paragraph, i (i)}
							<p class="whitespace-pre-line {i > 0 ? 'mt-2' : ''}">{paragraph}</p>
						{/each}
					</div>
				{/if}
			{/if}
			{@render actionFooter(expanded)}
		</div>
	</a>
	{#if bottomReach > 0}
		<!-- A scroll container's own bottom padding does not reach under content that hangs out of
		     the flow: scrollable overflow counts descendant border boxes, and <main>'s padding sits
		     inside its own box. So a grown card in the last row scrolls up flush against the window
		     edge. This empty box is that border box — it reaches BOTTOM_AIR past the card's bottom,
		     and outlives the expansion by however much of that room the reader is standing on. -->
		<div
			class="pointer-events-none absolute inset-x-0 top-0"
			style="height: {bottomReach}px"
			aria-hidden="true"
		></div>
	{/if}
	</div>
{/if}

{#if ui.layoutMode === 'expanded' && isSelected && !ui.isMobile}
	<div class="{viewMode === 'list' ? 'shadow-[0_1px_0_var(--color-n-200)]' : viewMode === 'magazine' ? 'col-span-full rounded-xl shadow-card overflow-hidden' : 'col-span-full'} bg-surface">
		<ArticleView {entry} onClose={() => ui.selectEntry(null)} />
	</div>
{/if}

{#if menu}
	<ContextMenu x={menu.x} y={menu.y} items={menuItems} onclose={() => (menu = null)} />
{/if}
