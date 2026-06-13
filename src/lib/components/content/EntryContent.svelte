<script lang="ts">
	import type { Entry } from '$lib/types';
	import { upgradeGalleryImages } from '$lib/content';

	let { entry }: { entry: Entry } = $props();

	const content = $derived(entry.content ? upgradeGalleryImages(entry.content) : '');
</script>

<div class="py-3 px-1">
	<article class="prose prose-sm max-w-none break-words">
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
      @apply mb-6;
    }
    ul {
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
