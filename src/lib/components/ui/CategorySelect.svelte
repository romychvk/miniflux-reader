<script lang="ts">
	import { feeds } from '$lib/stores/feeds.svelte';
	import { NEW_CATEGORY_SENTINEL } from '$lib/category';

	// `value` is the selected category id, or NEW_CATEGORY_SENTINEL while creating a
	// new one. When creating, `newName` holds the typed name — the parent's submit
	// handler is responsible for calling feeds.createCategory(newName) and using the
	// returned id. This component is presentational; it never talks to the API.
	let {
		value = $bindable(),
		newName = $bindable(''),
		id = 'category-select',
		selectClass = 'w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400 bg-surface',
		inputClass = 'mt-2 w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400'
	}: {
		value: number;
		newName?: string;
		id?: string;
		selectClass?: string;
		inputClass?: string;
	} = $props();

	const categories = $derived(feeds.getCategories());
</script>

<select {id} bind:value class={selectClass}>
	{#each categories as cat (cat.id)}
		<option value={cat.id}>{cat.title}</option>
	{/each}
	<option value={NEW_CATEGORY_SENTINEL}>＋ New category…</option>
</select>

{#if value === NEW_CATEGORY_SENTINEL}
	<!-- svelte-ignore a11y_autofocus -->
	<input
		type="text"
		bind:value={newName}
		placeholder="New category name"
		autofocus
		class={inputClass}
	/>
{/if}
