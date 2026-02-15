<script lang="ts">
	import { page } from '$app/state';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { parseFeedSlugId } from '$lib/slug';
	import EntryList from '$lib/components/content/EntryList.svelte';

	$effect(() => {
		const _showAll = entries.showAll;
		const slug = page.params.slug;
		const id = parseFeedSlugId(slug);
		if (id === null) return;

		const node = feeds.findFeedNodeById(id, true);
		if (node) {
			ui.selectFeed(node);
			entries.loadEntries(node.apiPath);
		}
	});
</script>

<EntryList />
