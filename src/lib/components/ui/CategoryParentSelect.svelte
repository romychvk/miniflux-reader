<script lang="ts">
	import { feeds } from '$lib/stores/feeds.svelte';

	// Where a category sits: the top level (null) or under another category (caps.nestedCategories).
	// Every category is listed for its place in the tree, the ones it may not go under disabled: a
	// category that holds feeds, and — when an existing category is being moved (`excludeId`) — the
	// category itself and everything under it. The default category is not offered at all: it
	// takes no subcategories. Presentational; the caller saves.
	let {
		value = $bindable(),
		excludeId,
		id = 'category-parent'
	}: {
		value: number | null;
		excludeId?: number;
		id?: string;
	} = $props();

	const defaultId = $derived(feeds.getNoCategoryId());
	const options = $derived(feeds.categoryOptions().filter((o) => o.id !== defaultId));
	const excluded = $derived(excludeId === undefined ? new Set<number>() : feeds.subtreeIdsOf(excludeId));
</script>

<select
	{id}
	bind:value
	class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400 bg-surface"
>
	<option value={null}>— Top level —</option>
	{#each options as cat (cat.id)}
		<option value={cat.id} disabled={cat.holdsFeeds || excluded.has(cat.id)}>
			{'   '.repeat(cat.depth)}{cat.title}
		</option>
	{/each}
</select>
