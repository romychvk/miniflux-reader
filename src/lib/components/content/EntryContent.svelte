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
    h3 {
      @apply text-xl mt-6 mb-4 font-bold;
    }
    p {
      @apply mb-4;
    }
    img {
      @apply mb-6 cursor-zoom-in;
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
    blockquote {
      @apply pl-5 border-l-6 border-l-neutral-200 text-sm;
    }
    iframe {
      @apply mb-4;
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
    /* Standalone images are wrapped in .prose-img (see processArticleHtml) so each sits as
       its own spaced block; list-item images and top-level <i> keep their own top spacing. */
    .prose-img {
      @apply mt-4;
    }
    .prose-img img {
      @apply block;
    }
    & > i,
    li > a > img {
      @apply block mt-4;
    }
  }
</style>
