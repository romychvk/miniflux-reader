<script lang="ts">
	import type { Entry } from '$lib/types';
	import { processArticleHtml, isImageUrl } from '$lib/content';
	import { ui } from '$lib/stores/ui.svelte';

	let { entry }: { entry: Entry } = $props();

	const content = $derived(entry.content ? processArticleHtml(entry.content) : '');

	// The lightbox URL for an image, or null if it shouldn't open one. Gallery images
	// (`<a href="full.jpg"><img>`) use their full-size href; a plain <img> uses its own
	// source. An <img> linking to a page (non-image href) is skipped so the link can
	// navigate, and tiny inline icons are skipped too.
	function lightboxUrlFor(img: HTMLImageElement): string | null {
		const href = img.closest('a')?.getAttribute('href') ?? null;
		let url: string;
		if (href !== null) {
			if (!isImageUrl(href)) return null; // link to a page — let it navigate
			url = href;
		} else {
			if (img.clientWidth < 100 && img.clientHeight < 100) return null; // inline icon
			url = img.currentSrc || img.getAttribute('src') || '';
		}
		if (!url || url.startsWith('data:')) return null;
		return url;
	}

	// Open content images in a lightbox, with arrow navigation across every eligible
	// image in this article. Event delegation keeps it working with {@html} markup.
	function onContentClick(e: MouseEvent) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
			return;
		const clicked = (e.target as HTMLElement).closest('img');
		if (!clicked) return;
		const clickedUrl = lightboxUrlFor(clicked);
		if (clickedUrl === null) return; // not eligible — let default happen

		// Dedupe by URL: lazy-load markup often duplicates an image in a <noscript>
		// fallback, which DOMParser exposes as a second <img> with the same source.
		const seen = new Map<string, number>();
		const gallery: string[] = [];
		for (const img of (e.currentTarget as HTMLElement).querySelectorAll('img')) {
			const url = lightboxUrlFor(img as HTMLImageElement);
			if (url === null || seen.has(url)) continue;
			seen.set(url, gallery.length);
			gallery.push(url);
		}

		e.preventDefault();
		ui.openLightbox(gallery, seen.get(clickedUrl) ?? 0);
	}
</script>

<div class="py-3 px-1">
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
	<article class="prose prose-sm max-w-none break-words" onclick={onContentClick}>
		{@html content}
	</article>
</div>

<style>
  @reference "../../../app.css";
  article.prose :global {
    h2 {
      @apply text-2xl mb-4 font-bold;
    }
    h3 {
      @apply text-xl mb-4 font-bold;
    }
    /* Top gap only between blocks — never above the article's first element */
    :is(h2, h3, div.prose-img, figure, pre):not(:first-child) {
      @apply mt-6;
    }
    p {
      @apply mb-4;
    }
    blockquote {
      @apply pl-5 border-l-6 border-l-n-200 text-sm mb-4;
      p {
        @apply mb-2;
      }
    }
    img {
      @apply mb-2 cursor-zoom-in;
    }
    ol, ul {
      @apply ml-5 mb-5 space-y-1.5;
    }
    li {
      @apply list-disc;
    }
    li:first-child {
      @apply mt-3;
    }
    b, strong {
      @apply font-bold;
    }

    /* Code blocks arrive in two shapes: the standard `<pre><code>…</code></pre>` holding
       real newlines, and — from feeds whose source markup was flattened upstream — one
       `<p>` per line inside the <code>. `white-space: pre` is inherited either way so
       indentation survives; the per-line paragraphs only need their prose margins off. */
    pre {
      @apply mb-6 overflow-x-auto rounded-lg border border-n-200 bg-n-100 p-4 text-sm leading-relaxed text-n-800;
      tab-size: 2;
    }
    /* A <figure> wrapper already carries the block's spacing — don't stack both. */
    figure:has(> pre) {
      @apply mb-6;
    }
    figure > pre {
      @apply my-0;
    }
    /* Inline code only — inside a block the <pre> is already the frame. The size stays
       em-relative so a chip keeps its proportion wherever it sits (body text, a heading,
       a blockquote); an absolute `text-*` here would also carry a line-height, which
       --tw-leading (`inherits: false`) would not let the <pre> override back. */
    :not(pre) > code {
      @apply rounded border border-n-200 bg-n-100 px-1 py-0.5 text-[0.875em] text-n-800;
    }
    pre code {
      @apply block;
    }
    pre code p {
      @apply mb-0;
    }
    /* Diff markers: `<ins>`/`<del>` would otherwise render as a bare underline and
       strikethrough. Tint them instead, with no padding so the columns stay aligned.
       The tint is the signal, so syntax color inside a marked run stands down rather
       than stack on it — a green string on the green "added" tint measures 2.44:1. */
    pre :is(ins, del, mark),
    pre :is(ins, del, mark) [class^='tok-'] {
      @apply no-underline text-inherit;
    }
    pre ins {
      @apply bg-success/20;
    }
    pre del {
      @apply bg-danger/20 line-through;
    }
    pre mark {
      @apply bg-warning/25;
    }
    /* Syntax tokens (emitted by $lib/highlight.ts) ride the theme ramp rather than a
       highlighter's own stylesheet, so code follows every preset and custom theme. */
    pre .tok-comment {
      @apply text-n-500 italic;
    }
    pre .tok-kw {
      @apply text-a-600;
    }
    pre .tok-string {
      @apply text-success;
    }
    pre .tok-num {
      @apply text-warning;
    }
    pre .tok-key {
      @apply text-danger;
    }

    iframe {
      @apply my-8;
    }
    /* Video embeds carry a fixed width="640" height="360"; max-w-full alone shrinks the
       width but keeps the height, cropping the player on narrow screens. Scale them
       proportionally instead. Scoped to video hosts so fixed-height audio players
       (bandcamp/soundcloud below) keep their own aspect ratio. */
    iframe[src*="youtube"],
    iframe[src*="youtu.be"],
    iframe[src*="vimeo"],
    iframe[src*="dailymotion"],
    iframe[src*="dai.ly"],
    iframe[src*="bilibili"] {
      @apply w-full h-auto;
      max-width: 640px;
      aspect-ratio: 16 / 9;
    }
    p:has(iframe[src^="https://bandcamp.com"]) {
      @apply mb-0;
      iframe {
        @apply -mb-2;
      }
    }
    figure {
      @apply mb-8;
    }
    figcaption {
      @apply text-center text-sm mt-3;
    }
    /* Standalone images are wrapped in .prose-img (see processArticleHtml) so each sits as
       its own spaced block; list-item images and top-level <i> keep their own top spacing. */
    .prose-img {
      @apply mb-8;
    }
    .prose-img img {
      @apply block mx-auto;
    }
    & > i,
    li > a > img {
      @apply block mt-4;
    }
  }
</style>
