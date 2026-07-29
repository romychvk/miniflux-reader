<script lang="ts">
	import { X, RotateCw, ChevronLeft, ChevronRight, Ban, Bookmark, ArrowLeft, ExternalLink } from 'lucide-svelte';
	import { goto, onNavigate } from '$app/navigation';
	import type { Entry } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { relaTimestamp } from '$lib/time';
	import { makeEntrySlug, makeFeedSlug } from '$lib/slug';
	import { categoryDisplayTitle } from '$lib/category';
	import { contentContainsImage } from '$lib/content';
	import { entryLang } from '$lib/lang';
	import EntryContent from './EntryContent.svelte';

	let { entry, onClose }: { entry: Entry; onClose?: () => void } = $props();

	const feedIcon = $derived(feeds.findFeedNodeById(entry.feed.id, true)?.iconData);

	// Breadcrumbs replace the app top bar on the full-page route (and the feed line that used to
	// sit under the H1 in panel/expanded mode). Prefer the locally-loaded feed over the copy
	// embedded in the entry: it stays in sync after a rename or a category move.
	const rawFeed = $derived(feeds.getRawFeed(entry.feed.id));
	const feedTitle = $derived(rawFeed?.title || entry.feed.title);
	const feedHref = $derived(`/feed/${makeFeedSlug(entry.feed.id, feedTitle)}`);
	const feedSiteUrl = $derived(rawFeed?.site_url || entry.feed.site_url || '');
	const category = $derived(rawFeed?.category ?? entry.feed.category ?? null);
	const categoryTitle = $derived(category ? categoryDisplayTitle(category.title) : '');
	const categoryHref = $derived(category ? `/category/${makeFeedSlug(category.id, categoryTitle)}` : '');

	// Full-page mode (the /article route) has no onClose; the three-column panel passes one.
	// Prev/next navigation only applies to the full-page route. The list is already ordered
	// published_at desc and filtered by the active all/unread mode, so neighbours come for free.
	const idx = $derived(entries.entries.findIndex((e) => e.id === entry.id));
	const prevEntry = $derived(idx > 0 ? entries.entries[idx - 1] : null); // ← newer (above)
	const nextEntry = $derived(
		idx >= 0 && idx < entries.entries.length - 1 ? entries.entries[idx + 1] : null
	); // → older (below)

	// Replace (don't push) so the back stack stays [list, article]: the Close button's
	// history.back() always returns to the originating list, not the previously-flipped article,
	// and paging through many articles doesn't bloat history. `dir` drives the page slide below.
	let navDir: 'prev' | 'next' | null = null;
	function navigate(e: Entry | null, dir: 'prev' | 'next') {
		if (!e) return;
		navDir = dir;
		goto(`/article/${makeEntrySlug(e.id, e.title)}`, { replaceState: true });
	}

	// The article's scroll lives on an ancestor container (<main> in full-page mode); walk up to
	// find it. Used both to reset the incoming article to the top and to snapshot the outgoing one
	// from the top during the page-turn transition.
	let rootEl = $state<HTMLElement>();
	function scrollParent(el: HTMLElement | undefined): HTMLElement | null {
		for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
			const oy = getComputedStyle(node).overflowY;
			if (oy === 'auto' || oy === 'scroll') return node;
		}
		return null;
	}

	// "Page-turn" slide between articles via the View Transitions API. Only prev/next navigation
	// (navDir set) animates; other navigations and unsupported browsers fall through to an instant
	// swap. The direction class on <html> selects the slide direction (CSS lives in app.css), and
	// only the article content carries view-transition-name, so the sidebar/topbar don't move.
	onNavigate((navigation) => {
		const dir = navDir;
		navDir = null;
		const startViewTransition = (
			document as Document & { startViewTransition?: (cb: () => unknown) => { finished: Promise<unknown> } }
		).startViewTransition;
		if (!dir || !startViewTransition) return;

		// Snapshot the outgoing article from the top as well. The incoming one already starts at
		// the top (the $effect below), so if the old one keeps a scrolled-down offset,
		// ::view-transition-group(article) has to interpolate that whole vertical gap — and the
		// horizontal page-turn reads as a jump to the top of the page instead. Resetting here,
		// before the transition captures the old state, keeps both edges aligned so only the
		// sideways slide shows. (No visible jump: capture happens before the next paint.)
		const sc = scrollParent(rootEl);
		if (sc) sc.scrollTop = 0;

		document.documentElement.classList.add(dir === 'next' ? 'va-next' : 'va-prev');
		return new Promise<void>((resolve) => {
			const transition = startViewTransition.call(document, async () => {
				resolve();
				await navigation.complete;
			});
			transition.finished.finally(() =>
				document.documentElement.classList.remove('va-next', 'va-prev')
			);
		});
	});

	// Every article starts at the top. The scroll lives on an ancestor container — <main> in
	// full-page mode — which SvelteKit's window-scroll management never resets, so paging to a
	// neighbour would otherwise keep the previous article's offset and drop the reader into the
	// middle of the new one. (Panel mode remounts via {#key}, so its container is already fresh.)
	$effect(() => {
		entry.id; // re-run whenever the shown article changes
		const sc = scrollParent(rootEl);
		if (sc) sc.scrollTop = 0;
	});

	// Briefly press the matching arrow so a keyboard ←/→ gives the same visual feedback a click does.
	let pressed = $state<'prev' | 'next' | null>(null);
	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	function flash(side: 'prev' | 'next') {
		pressed = side;
		clearTimeout(pressTimer);
		pressTimer = setTimeout(() => (pressed = null), 160);
	}

	$effect(() => {
		if (onClose) return; // panel mode — no keyboard nav
		function onKeydown(ev: KeyboardEvent) {
			if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
			if (ui.lightboxImage) return; // lightbox owns arrow keys while open
			const el = document.activeElement;
			if (el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))
				return;
			if (ev.key === 'ArrowLeft' && prevEntry) {
				ev.preventDefault();
				flash('prev');
				navigate(prevEntry, 'prev');
			} else if (ev.key === 'ArrowRight' && nextEntry) {
				ev.preventDefault();
				flash('next');
				navigate(nextEntry, 'next');
			}
		}
		window.addEventListener('keydown', onKeydown);
		return () => {
			window.removeEventListener('keydown', onKeydown);
			clearTimeout(pressTimer);
		};
	});

	// Show the resolved cover (rutracker's postImg / a feed's og:image) at the top when the
	// article body doesn't already contain that image — some sources keep the cover out of the
	// post HTML, so the article would otherwise be imageless even though the card has a thumb.
	const coverUrl = $derived(entry._thumbnailUrl ?? null);
	const showCover = $derived(!!coverUrl && !contentContainsImage(entry.content ?? '', coverUrl));

	$effect(() => {
		if (!entry._thumbnailUrl && entry.url) entries.ensureThumbnail(entry);
	});

	function openCover() {
		if (coverUrl) ui.openLightbox([coverUrl], 0);
	}

	let refetching = $state(false);

	async function refetch() {
		refetching = true;
		const content = await entries.refetchContent(entry.id);
		if (content !== null) {
			entry.content = content;
			ui.showSuccess('Content re-fetched.');
		}
		refetching = false;
	}

	function goBack() {
		history.back();
	}
</script>

<div class="relative" bind:this={rootEl}>
	<!-- All floating controls (close + prev/next arrows) share ONE sticky, zero-height bar so they
	     position against the same box: this full-width wrapper, which spans the scroll container's
	     content area. Don't use `fixed` here — it measures from the viewport, which includes the
	     scroll container's scrollbar, so a `fixed right-4` close button lands ~a scrollbar-width
	     further right than an `absolute right-4` arrow. Sticky + top-0 keeps them pinned to the
	     scrollport while the article scrolls (the arrows' top-[50vh] then reads as viewport-centred).
	     The bar lives in the outer wrapper (the UI layer), NOT inside .article-vt — otherwise it
	     gets captured by the article view-transition snapshot and slides with the page. -->
	<div class="sticky top-0 h-0 z-30 pointer-events-none">
		{#if !onClose && prevEntry}
			<button
				onclick={() => navigate(prevEntry, 'prev')}
				class="nav-arrow pointer-events-auto absolute left-2 md:left-4 top-[50vh] -translate-y-1/2 rounded-full p-1.75 text-n-700 bg-surface shadow-md hover:bg-n-100 hover:text-n-900"
				class:pressed={pressed === 'prev'}
				title="Previous article"
			>
				<ChevronLeft class="size-6.5" />
			</button>
		{/if}
		{#if !onClose && nextEntry}
			<button
				onclick={() => navigate(nextEntry, 'next')}
				class="nav-arrow pointer-events-auto absolute right-2 md:right-4 top-[50vh] -translate-y-1/2 rounded-full p-1.75 text-n-700 bg-surface shadow-md hover:bg-n-100 hover:text-n-900"
				class:pressed={pressed === 'next'}
				title="Next article"
			>
				<ChevronRight class="size-6.5" />
			</button>
		{/if}
		<button
			onclick={onClose ?? goBack}
			class="pointer-events-auto absolute right-2 md:right-4 top-2 rounded-full p-1.75 text-n-700 bg-surface shadow-md hover:bg-n-100 hover:text-n-900"
			title="Close article"
		>
			<X class="size-6.5" />
		</button>
	</div>

	<!-- The @container is the measuring block for the hero-image breakout (cqw units in
	     .hero-breakout here and the lead-image rule in EntryContent). It wraps only the article
	     column: inline-size containment would make this div the positioning ancestor of the
	     fixed/sticky buttons above, so they stay outside it. -->
	<div class="@container">
	<!-- Without the breadcrumbs row, panel/expanded mode starts straight on the H1 — so it has to
	     open below the floating Close button (top-2 + its 40px box) or a long first line runs
	     under it. The full-page route keeps the tighter top: the breadcrumbs sit there instead. -->
	<div class="max-w-3xl mx-auto px-6 pb-4 {onClose ? 'pt-14' : 'pt-4'} relative" class:article-vt={!onClose}>
	<!-- Breadcrumbs stand in for the app top bar, which the full-page route hides. Panel and
	     expanded mode keep that top bar and sit right next to the feed list, so there the row
	     would only repeat the feed the reader just clicked in. -->
	{#if !onClose}
	<nav class="flex justify-center items-center gap-0.5 text-sm text-n-800 mb-6 min-w-0 pr-10">
		<!-- {#if !onClose}
			<button
				onclick={goBack}
				title="Back"
				class="shrink-0 -ml-1.5 p-1 rounded-md hover:bg-n-200 bg-n-100 hover:text-n-800 transition-colors"
			>
				<ArrowLeft size={18} />
			</button>
		{/if} -->
		{#if category}
			<a href={categoryHref} class="shrink-0 truncate hover:text-n-800 underline transition-colors hover:bg-n-200 rounded px-2 py-1 hover:no-underline">{categoryTitle}</a>
			<ChevronRight size={14} class="shrink-0 text-n-600" />
		{/if}
		<a href={feedHref} class="flex items-center gap-1.5 min-w-0 hover:text-n-800 underline transition-colors rounded px-2 py-1 hover:bg-n-200 hover:no-underline">
			{#if feedIcon}
				<img src={feedIcon} alt="" class="size-3.5 shrink-0" />
			{/if}
			<span class="truncate">{feedTitle}</span>
		</a>
		<!-- {#if feedSiteUrl}
			<a
				href={feedSiteUrl}
				target="_blank"
				rel="noopener noreferrer"
				title="Open site"
				class="shrink-0 text-n-600 hover:text-n-800 hover:bg-n-200 transition-colors bg-n-100 rounded-full size-7 flex items-center justify-center"
			>
				<ExternalLink size={16} />
			</a>
		{/if} -->
	</nav>
	{/if}

	<h1 class="text-[34px] leading-snug text-center font-semibold mb-4 px-6" lang={entryLang(entry)}>{entry.title}</h1>

	<div class="flex flex-wrap items-center justify-center gap-1 text-sm text-n-600 mb-8">
		<span>{relaTimestamp(entry.published_at)}</span>
		{#if entry.author}
		  <span class="mx-1 h-4 w-px bg-n-200"></span>
			<span>{entry.author}</span>
		{/if}
		<span class="mx-1 h-4 w-px bg-n-200"></span>
		<a
			href={entry.url}
			target="_blank"
			rel="noopener noreferrer"
			title="Open the original article"
			class="underline transition-colors rounded px-1.5 py-0.5 hover:text-n-800 hover:bg-n-200 hover:no-underline"
		>
			Source
		</a>
		<span class="ml-1 mr-0.5 h-4 w-px bg-n-200"></span>
		<button
			onclick={() => entries.toggleBookmark(entry.id)}
			title={(entry.starred ?? false) ? 'Remove bookmark' : 'Bookmark'}
			class="shrink-0 flex justify-center items-center size-7 rounded-full transition-colors {(entry.starred ?? false) ? 'text-a-600 hover:bg-n-200' : 'text-n-400 hover:text-n-600 hover:bg-n-200'}"
		>
			<Bookmark size={16} fill={(entry.starred ?? false) ? 'currentColor' : 'none'} />
		</button>
		<button
			onclick={() => ui.openFilterModal({ feedId: entry.feed.id, feedTitle: entry.feed.title, seedTitle: entry.title })}
			title="Ignore posts like this"
			class="shrink-0 rounded-full size-7 flex items-center justify-center text-n-400 hover:text-n-700 hover:bg-n-200 transition-colors"
		>
			<Ban size={16} />
		</button>
		<button
			onclick={refetch}
			disabled={refetching}
			title="Re-fetch original content (applies the feed's rules)"
			class="shrink-0 flex justify-center items-center size-7 rounded-full text-n-400 hover:text-n-700 hover:bg-n-200 transition-colors disabled:opacity-50"
		>
			<RotateCw size={16} class={refetching ? 'animate-spin' : ''} />
		</button>
	</div>

	{#if showCover}
		<!-- The breakout div (not the button) carries the width so the click target stays the
		     image itself: the button shrink-wraps its img and centres inside the wider block. -->
		<div class="hero-breakout mb-5">
			<button type="button" onclick={openCover} class="block mx-auto" title="Open image">
				<img src={coverUrl} alt={entry.title} class="max-w-full h-auto rounded-lg cursor-zoom-in" />
			</button>
		</div>
	{/if}

	<EntryContent {entry} />
	</div>
	</div>
</div>

<style>
	/* Gentle press reaction for the prev/next arrows — fires on click (:active) and on a
	   keyboard ←/→ (.pressed). Uses the standalone `scale` property so it composes with the
	   button's Tailwind translate-based vertical centring instead of overriding it. */
	.nav-arrow {
		transition: scale 150ms ease;
	}
	.nav-arrow:active,
	.nav-arrow.pressed {
		scale: 0.85;
	}

	/* Wider than the text column, centred via symmetric negative margins; --hero-breakout-w
	   (app.css) resolves its % and cqw here, against this element's containing block and the
	   @container above. */
	.hero-breakout {
		width: var(--hero-breakout-w);
		margin-inline: calc((100% - var(--hero-breakout-w)) / 2);
	}
</style>
