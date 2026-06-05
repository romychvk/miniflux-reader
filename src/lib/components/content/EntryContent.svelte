<script lang="ts">
	import type { Entry } from '$lib/types';

	let { entry }: { entry: Entry } = $props();
</script>

<div class="py-3 px-1">
	<article class="prose prose-sm max-w-none break-words">
		{@html entry.content}
	</article>
</div>

<style>                                                                                                               
  @reference "../../../app.css";
  article.prose :global {
    p {
      @apply mb-4;
    }
    img {
      @apply mb-6;
    }
  }                                                                                                
</style>
