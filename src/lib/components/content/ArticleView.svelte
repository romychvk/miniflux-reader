<script lang="ts">
	import { X, RotateCw, ChevronLeft, ChevronRight, Ban, Bookmark, Check, Circle, Ellipsis, ExternalLink, Expand, Shrink } from 'lucide-svelte';
	import { goto, onNavigate } from '$app/navigation';
	import type { Entry } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { relaTimestamp } from '$lib/time';
	import { makeEntrySlug, makeFeedSlug } from '$lib/slug';
	import { categoryDisplayTitle } from '$lib/category';
	import { contentContainsImage } from '$lib/content';
	import { archivedSrc } from '$lib/imageArchive';
	import { entryLang } from '$lib/lang';
	import EntryContent from './EntryContent.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';

	let { entry, onClose }: { entry: Entry; onClose?: () => void } = $props();

	const feedIcon = $derived(feeds.findFeedNodeById(entry.feed.id, true)?.iconData);

	// Breadcrumbs replace the app top bar on the full-page route (and the feed line that used to
	// sit under the H1 in panel/expanded mode). Prefer the locally-loaded feed over the copy
	// embedded in the entry: it stays in sync after a rename or a category move.
	const rawFeed = $derived(feeds.getRawFeed(entry.feed.id));
	const feedTitle = $derived(rawFeed?.title || entry.feed.title);
	const feedHref = $derived(`/feed/${makeFeedSlug(entry.feed.id, feedTitle)}`);
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
	// Full-page only: expanded mode shares <main> with the list it is opened inside, and that
	// scroll belongs to the list — EntryRow brings the open row into view itself.
	$effect(() => {
		entry.id; // re-run whenever the shown article changes
		if (onClose) return;
		const sc = scrollParent(rootEl);
		if (sc) sc.scrollTop = 0;
	});

	// Zen mode. Only the full-page route can be zen (onClose ⇒ panel/expanded), and EntryRow routes
	// every click there while it's on, so this is the one place the mode is visible.
	// The prev/next arrows fade out and come back when the pointer nears either screen edge —
	// tracked in JS rather than with a CSS hover strip so no invisible band steals clicks or text
	// selection from the article. EDGE_REVEAL_PX is the knob worth trying out in the browser.
	const EDGE_REVEAL_PX = 80;
	const zen = $derived(ui.zenMode && !onClose && !ui.isMobile);

	function toggleZen() {
		// Zen is the full-window view, and only the /article route provides it — so from the panel
		// and inline placements entering it is a navigation. Push (not replace) so leaving lands the
		// reader back on the list with the panel still open on this entry: ui.selectedEntry survives
		// navigation and ArticlePanel remounts from it.
		if (onClose) {
			ui.enterZenFromPane();
			goto(`/article/${makeEntrySlug(entry.id, entry.title)}`);
			return;
		}
		// Same jump, seen from the other end: this instance is the full-page route, but the reader's
		// pane is a split one, so un-hiding the sidebar would strand them in a "No split" they never
		// chose. Travel back to the pane instead — the layout effect clears the override on the way.
		if (ui.zenCameFromPane) {
			goBack();
			return;
		}
		ui.toggleZen();
	}
	let nearEdge = $state(false);
	// Derived rather than reset in the effect's teardown: teardown observes the *previous* run's
	// state, so leaving zen this way hides nothing stale — arrowsHidden simply goes false at once.
	const arrowsHidden = $derived(zen && !nearEdge);

	$effect(() => {
		if (!zen) return;
		let last = false; // plain closure var — reading nearEdge here would re-subscribe the effect
		function onMove(ev: MouseEvent) {
			const near = ev.clientX <= EDGE_REVEAL_PX || ev.clientX >= window.innerWidth - EDGE_REVEAL_PX;
			if (near !== last) {
				last = near;
				nearEdge = near;
			}
		}
		window.addEventListener('mousemove', onMove);
		return () => window.removeEventListener('mousemove', onMove);
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

	// Show the resolved cover (a cover-rule match / a feed's og:image) at the top when the
	// article body doesn't already contain that image — some sources keep the cover out of the
	// post HTML, so the article would otherwise be imageless even though the card has a thumb.
	const coverUrl = $derived(entry._thumbnailUrl ?? null);
	// Our archived copy first when the feed has archiving on, the source as the fallback for
	// anything not downloaded yet. A source that refuses to serve its images to a third-party page
	// (hotlink protection, a bot challenge) leaves a broken-image glyph where the hero should be,
	// so once the whole chain has failed the cover block is dropped instead.
	const coverChain = $derived.by(() => {
		if (!coverUrl) return [] as string[];
		return entry._archiveImages ? [archivedSrc(coverUrl), coverUrl] : [coverUrl];
	});
	let coverFailed = $state({ key: '', count: 0 });
	const coverSrc = $derived.by(() => {
		const chain = coverChain;
		if (chain.length === 0) return null;
		return chain[coverFailed.key === chain[0] ? coverFailed.count : 0] ?? null;
	});
	const showCover = $derived(
		!!coverUrl && !!coverSrc && !contentContainsImage(entry.content ?? '', coverUrl)
	);

	function coverLoadFailed() {
		const key = coverChain[0] ?? '';
		coverFailed = { key, count: (coverFailed.key === key ? coverFailed.count : 0) + 1 };
	}

	$effect(() => {
		if (!entry._thumbnailUrl && entry.url) entries.ensureThumbnail(entry);
	});

	function openCover() {
		// whatever the hero actually resolved to — showing the source in the lightbox would fail
		// for exactly the feeds the archive exists for
		if (coverSrc) ui.openLightbox([coverSrc], 0);
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

	// The ⋯ menu: the rarer article actions, kept out of the meta row.
	let kebab = $state<{ x: number; y: number } | null>(null);
	let kebabBtn = $state<HTMLButtonElement | null>(null);
	const isRead = $derived(entry.status === 'read');

	function toggleKebab() {
		if (kebab || !kebabBtn) {
			kebab = null;
			return;
		}
		const r = kebabBtn.getBoundingClientRect();
		kebab = { x: r.right, y: r.bottom + 6 };
	}

	const kebabItems = $derived([
		{
			label: 'Re-fetch original content',
			icon: RotateCw,
			iconClass: refetching ? 'animate-spin' : '',
			disabled: refetching,
			action: () => void refetch()
		},
		{
			label: isRead ? 'Mark as unread' : 'Mark as read',
			icon: isRead ? Circle : Check,
			action: () => entries.markRead([entry.id], !isRead)
		},
		{
			label: 'Ignore posts like this…',
			icon: Ban,
			divider: true,
			action: () =>
				ui.openFilterModal({ feedId: entry.feed.id, feedTitle: entry.feed.title, seedTitle: entry.title })
		}
	]);

	// Shared looks: the white floating buttons (Close, prev/next), the meta-row icon buttons and
	// the two links of the breadcrumb chip.
	const floating =
		'pointer-events-auto absolute grid place-items-center rounded-full bg-surface text-n-700 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-n-900)_8%,transparent),0_4px_12px_color-mix(in_oklab,var(--color-n-900)_15%,transparent)] transition-colors hover:bg-n-100 hover:text-n-900';
	const metaBtn = 'grid place-items-center size-8 rounded-full transition-colors hover:bg-n-100 hover:text-n-900';
	const crumb =
		'flex items-center gap-1.5 h-6.5 px-2.25 rounded-full transition-colors duration-120 hover:bg-a-50 hover:text-a-700 active:bg-a-600/15';

	function goBack() {
		// An article opened in its own tab — a middle-clicked card — is that tab's first page, so
		// back() is a no-op and the reader would be stuck on it with a Close button that does
		// nothing. Land them in the article's feed instead, which turns the tab into a full reader.
		if (history.length > 1) history.back();
		else goto(feedHref);
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
				class="nav-arrow {floating} size-10 left-2 md:left-4 top-[50vh] -translate-y-1/2"
				class:pressed={pressed === 'prev'}
				class:zen-hidden={arrowsHidden}
				title="Previous article"
			>
				<ChevronLeft size={22} strokeWidth={2.2} />
			</button>
		{/if}
		{#if !onClose && nextEntry}
			<button
				onclick={() => navigate(nextEntry, 'next')}
				class="nav-arrow {floating} size-10 right-2 md:right-4 top-[50vh] -translate-y-1/2"
				class:pressed={pressed === 'next'}
				class:zen-hidden={arrowsHidden}
				title="Next article"
			>
				<ChevronRight size={22} strokeWidth={2.2} />
			</button>
		{/if}
		<button
			onclick={onClose ?? goBack}
			class="{floating} size-9 right-2 md:right-4 top-3"
			title="Close article"
		>
			<X size={18} strokeWidth={2.2} />
		</button>
	</div>

	<!-- The @container is the measuring block for the hero-image breakout (cqw units in
	     .hero-breakout here and the lead-image rule in EntryContent). It wraps only the article
	     column: inline-size containment would make this div the positioning ancestor of the
	     fixed/sticky buttons above, so they stay outside it. In the panel the hero only bleeds
	     12px past each side of the column. -->
	<div class="@container {onClose ? '[--hero-breakout-w:calc(100%_+_24px)]' : ''}">
	<div
		class="mx-auto relative {onClose ? 'max-w-[696px] px-7 pb-8' : 'max-w-[808px] px-6 pb-10'}"
		class:article-vt={!onClose}
	>
		<div class={zen ? 'text-center' : ''}>
			<!-- Header row: the breadcrumb chip, in every placement. The floating Close button sits over
			     this row's right end whenever the column reaches it — always in the panel, and on the
			     full-page route until <main> is wide enough (~55rem) for the column to stop short of it.
			     Left-aligned rows just reserve the room; Zen's centred chip uses two flex spacers with the
			     floor only on the right, so it stays centred until it would actually run under the button. -->
			<div
				class="h-14 flex items-center min-w-0 {zen
					? "justify-center before:flex-1 before:content-[''] after:flex-1 after:content-[''] after:min-w-11 @[55rem]:after:min-w-0"
					: onClose
						? 'pr-11'
						: 'pr-11 @[55rem]:pr-0'}"
			>
				<nav class="flex items-center h-6.5 min-w-0 rounded-full bg-n-100 text-[12.5px] font-medium text-n-700">
					{#if category}
						<a href={categoryHref} class="{crumb} shrink-0 whitespace-nowrap">{categoryTitle}</a>
						<ChevronRight size={12} strokeWidth={2.5} class="shrink-0 -mx-1 text-n-400/80" />
					{/if}
					<a href={feedHref} class="{crumb} min-w-0">
						{#if feedIcon}
							<img src={feedIcon} alt="" class="size-3.5 rounded-[3px] shrink-0" />
						{/if}
						<span class="truncate">{feedTitle}</span>
					</a>
				</nav>
			</div>

			<h1
				class="font-bold tracking-[-0.015em] text-balance {onClose
					? 'text-[22px] leading-[1.3] mt-1.5 mb-3.5'
					: `text-[30px] leading-[1.25] ${zen ? 'mt-2.5' : 'mt-1.5'} mb-4.5`}"
				lang={entryLang(entry)}
			>
				{entry.title}
			</h1>

			<div
				class="flex flex-wrap items-center gap-x-3.5 gap-y-1 pb-3 mb-5.5 border-b border-n-200/60 {zen
					? 'justify-center'
					: 'justify-between'}"
			>
				<div class="flex items-center gap-2 min-w-0 text-[13px] text-n-500 whitespace-nowrap">
					{#if entry.author}
						<span class="font-semibold text-n-700 truncate">{entry.author}</span>
						<span class="text-n-300">&middot;</span>
					{/if}
					<span class="shrink-0">{relaTimestamp(entry.published_at)}</span>
					<span class="text-n-300">&middot;</span>
					<a
						href={entry.url}
						target="_blank"
						rel="noopener noreferrer"
						title="Open the original article"
						class="shrink-0 flex items-center gap-1.25 transition-colors hover:text-n-900 hover:underline underline-offset-3 decoration-1"
					>
						Open original
						<ExternalLink size={13} />
					</a>
				</div>
				{#if zen}
					<span class="w-px h-4 bg-n-200"></span>
				{/if}
				<div class="flex items-center gap-0.5 shrink-0">
					<button
						onclick={() => entries.toggleBookmark(entry.id)}
						title={(entry.starred ?? false) ? 'Remove bookmark' : 'Bookmark'}
						aria-label={(entry.starred ?? false) ? 'Remove bookmark' : 'Bookmark'}
						class="{metaBtn} {(entry.starred ?? false) ? 'text-a-700' : 'text-n-500'}"
					>
						<Bookmark size={17} fill={(entry.starred ?? false) ? 'currentColor' : 'none'} />
					</button>
					{#if !ui.isMobile}
						<button
							onclick={toggleZen}
							title={ui.zenMode ? 'Exit Zen mode' : 'Zen mode'}
							aria-label={ui.zenMode ? 'Exit Zen mode' : 'Zen mode'}
							class="{metaBtn} {ui.zenMode ? 'text-a-700' : 'text-n-500'}"
						>
							{#if ui.zenMode}
								<Shrink size={17} />
							{:else}
								<Expand size={17} />
							{/if}
						</button>
					{/if}
					<button
						bind:this={kebabBtn}
						onclick={toggleKebab}
						title="More"
						aria-label="More actions"
						aria-haspopup="menu"
						aria-expanded={!!kebab}
						class="{metaBtn} {kebab ? 'bg-a-50 text-a-700 hover:bg-a-50 hover:text-a-700' : 'text-n-500'}"
					>
						<Ellipsis size={17} />
					</button>
				</div>
			</div>
		</div>

		{#if showCover}
			<!-- The breakout div (not the button) carries the width so the click target stays the
			     image itself: the button shrink-wraps its img and centres inside the wider block. -->
			<div class="hero-breakout mb-5">
				<button type="button" onclick={openCover} class="block mx-auto" title="Open image">
					<img
						src={coverSrc}
						alt={entry.title}
						class="max-w-full h-auto rounded-[10px] cursor-zoom-in"
						onerror={coverLoadFailed}
					/>
				</button>
			</div>
		{/if}

		<div
			class="text-n-800 {onClose
				? 'text-[15.5px] leading-[1.6] [--p-gap:14px]'
				: 'text-[17px] leading-[1.65] [--p-gap:18px]'}"
		>
			<EntryContent {entry} />
		</div>
	</div>
	</div>
</div>

{#if kebab}
	<ContextMenu
		x={kebab.x}
		y={kebab.y}
		items={kebabItems}
		anchor={kebabBtn}
		align="right"
		width={232}
		onclose={() => (kebab = null)}
	/>
{/if}

<style>
	/* Gentle press reaction for the prev/next arrows — fires on click (:active) and on a
	   keyboard ←/→ (.pressed). Uses the standalone `scale` property so it composes with the
	   button's Tailwind translate-based vertical centring instead of overriding it. */
	.nav-arrow {
		transition: scale 150ms ease, opacity 200ms ease;
	}
	.nav-arrow:active,
	.nav-arrow.pressed {
		scale: 0.85;
	}

	/* Zen mode parks the arrows out of sight until the pointer nears a screen edge. They keep
	   their pointer events: while invisible the cursor is by definition away from the edge, so
	   there is nothing under it to click by accident. */
	.nav-arrow.zen-hidden {
		opacity: 0;
	}

	/* Wider than the text column, centred via symmetric negative margins; --hero-breakout-w
	   (app.css) resolves its % and cqw here, against this element's containing block and the
	   @container above. */
	.hero-breakout {
		width: var(--hero-breakout-w);
		margin-inline: calc((100% - var(--hero-breakout-w)) / 2);
	}
</style>
