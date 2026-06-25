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
    /* Відступ зверху для елементів, які знаходяться прямо внутри article.prose */
    & > i,
    & > img,
    & > a > img,
    li > a > img {
      @apply block mt-4;
    }
  }
</style>
