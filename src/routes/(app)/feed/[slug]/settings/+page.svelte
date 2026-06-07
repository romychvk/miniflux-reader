<script lang="ts">
	import { page } from '$app/state';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { parseFeedSlugId } from '$lib/slug';
	import FeedSettings from '$lib/components/content/FeedSettings.svelte';

	const feedId = $derived(parseFeedSlugId(page.params.slug));
	const feed = $derived(feedId === null ? null : feeds.getRawFeed(feedId));

	$effect(() => {
		if (feedId === null) return;
		const node = feeds.findFeedNodeById(feedId, true);
		if (node) ui.selectFeed(node);
	});
</script>

{#if feed}
	{#key feed.id}
		<FeedSettings {feed} />
	{/key}
{:else}
	<div class="flex flex-col items-center justify-center gap-3 py-16 text-n-500">
		<p>Feed not found.</p>
		<a href="/" class="text-sm text-a-600 hover:text-a-700">← Back to all feeds</a>
	</div>
{/if}
