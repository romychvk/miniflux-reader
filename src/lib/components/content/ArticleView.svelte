<script lang="ts">
	import { X, RotateCw, ChevronLeft, ChevronRight, Ban, Bookmark } from 'lucide-svelte';
	import { goto, onNavigate } from '$app/navigation';
	import type { Entry } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { relaTimestamp } from '$lib/time';
	import { makeEntrySlug } from '$lib/slug';
	import { contentContainsImage } from '$lib/content';
	import EntryContent from './EntryContent.svelte';

	let { entry, onClose }: { entry: Entry; onClose?: () => void } = $props();

	const feedIcon = $derived(feeds.findFeedNodeById(entry.feed.id, true)?.iconData);

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
	<!-- Prev/next arrows (full-page mode only). Anchored to this full-width wrapper — which
	     spans the main content area, right of the sidebar — via a sticky, zero-height bar so the
	     arrows sit just inside the content area and stay vertically centred while scrolling. -->
	{#if !onClose && (prevEntry || nextEntry)}
		<div class="sticky top-0 h-0 z-30 pointer-events-none">
			{#if prevEntry}
				<button
					onclick={() => navigate(prevEntry, 'prev')}
					class="nav-arrow pointer-events-auto absolute left-2 md:left-4 top-[50vh] -translate-y-1/2 rounded-full p-1.75 text-n-700 bg-surface shadow-md hover:bg-n-100 hover:text-n-900"
					class:pressed={pressed === 'prev'}
					title="Previous article"
				>
					<ChevronLeft class="size-6.5" />
				</button>
			{/if}
			{#if nextEntry}
				<button
					onclick={() => navigate(nextEntry, 'next')}
					class="nav-arrow pointer-events-auto absolute right-2 md:right-4 top-[50vh] -translate-y-1/2 rounded-full p-1.75 text-n-700 bg-surface shadow-md hover:bg-n-100 hover:text-n-900"
					class:pressed={pressed === 'next'}
					title="Next article"
				>
					<ChevronRight class="size-6.5" />
				</button>
			{/if}
		</div>
	{/if}

	<!-- Close/back lives in the outer wrapper (the UI layer), NOT inside .article-vt — otherwise
	     it gets captured by the article view-transition snapshot and slides with the page. -->
	{#if onClose}
		<button
			onclick={onClose}
			class="fixed right-0 md:right-6 top-2 z-30 rounded-full p-1.75 text-n-700 bg-surface shadow-md hover:bg-n-100 hover:text-n-900"
			title="Close article"
		>
			<X class="size-6.5" />
		</button>
	{:else}
		<button
			onclick={goBack}
			class="fixed right-2 md:right-5 top-14 z-30 rounded-full p-1.75 text-n-700 bg-surface shadow-md hover:bg-n-100 hover:text-n-900"
			title="Close article"
		>
			<X class="size-6.5" />
		</button>
	{/if}

	<!-- The @container is the measuring block for the hero-image breakout (cqw units in
	     .hero-breakout here and the lead-image rule in EntryContent). It wraps only the article
	     column: inline-size containment would make this div the positioning ancestor of the
	     fixed/sticky buttons above, so they stay outside it. -->
	<div class="@container">
	<div class="max-w-3xl mx-auto px-6 py-4 relative" class:article-vt={!onClose}>
	<h1 class="text-3xl leading-snug text-center font-bold mb-3 px-6">
		<a href={entry.url} target="_blank" rel="noopener noreferrer" class="hover:underline">{entry.title}</a>
	</h1>

	<div class="flex flex-col items-center gap-3 text-sm text-n-500 mb-3">
    <div class="flex items-center gap-2">
  		{#if feedIcon}
  			<img src={feedIcon} alt="" class="size-3 mt-1 shrink-0" />
  		{/if}
  		<span>{entry.feed.title}</span>
      <span>&middot;</span>
  		<span>{relaTimestamp(entry.published_at)}</span>
  		{#if entry.author}
  			<span>&middot;</span>
  			<span>{entry.author}</span>
  		{/if}
    </div>
    <div class="flex items-center gap-2">
  		<button
  			onclick={() => ui.openFilterModal({ feedId: entry.feed.id, feedTitle: entry.feed.title, seedTitle: entry.title })}
  			title="Ignore posts like this"
  			class="ml-auto shrink-0 p-1 rounded-md text-n-400 hover:text-n-700 hover:bg-n-100 transition-colors"
  		>
  			<Ban size={14} />
  		</button>
  		<button
  			onclick={() => entries.toggleBookmark(entry.id)}
  			title={(entry.starred ?? false) ? 'Remove bookmark' : 'Bookmark'}
  			class="shrink-0 p-1 rounded-md transition-colors {(entry.starred ?? false) ? 'text-a-600 hover:bg-n-100' : 'text-n-400 hover:text-n-700 hover:bg-n-100'}"
  		>
  			<Bookmark size={14} fill={(entry.starred ?? false) ? 'currentColor' : 'none'} />
  		</button>
  		<button
  			onclick={refetch}
  			disabled={refetching}
  			title="Re-fetch original content (applies the feed's rules)"
  			class="shrink-0 p-1 rounded-md text-n-400 hover:text-n-700 hover:bg-n-100 transition-colors disabled:opacity-50"
  		>
  			<RotateCw size={14} class={refetching ? 'animate-spin' : ''} />
  		</button>
    </div>
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
