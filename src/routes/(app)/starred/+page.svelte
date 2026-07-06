<script lang="ts">
	import { feeds } from '$lib/stores/feeds.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import EntryList from '$lib/components/content/EntryList.svelte';

	$effect(() => {
		const _showAll = entries.showAll;
		const _search = entries.searchQuery;
		const node = feeds.getStarredNode();
		ui.selectFeed(node);
		entries.loadEntries(node.apiPath);
	});
</script>

<EntryList />
