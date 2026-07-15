<script lang="ts">
	import type { FeedCreate } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { NEW_CATEGORY_SENTINEL } from '$lib/category';
	import CategorySelect from './CategorySelect.svelte';

	let { onclose, onsave, onwizard, initialCategoryId }: {
		onclose: () => void;
		onsave: (data: FeedCreate) => Promise<void>;
		onwizard?: () => void;
		initialCategoryId?: number;
	} = $props();

	let feedUrl = $state('');
	let categoryId: number = $state(0);
	let newCategoryName = $state('');

	// Preselect the category the user acted on (e.g. right-clicked in the sidebar);
	// otherwise fall back to the "— Without category —" (Miniflux "All") bucket, so
	// leaving the picker untouched keeps a feed uncategorized.
	$effect(() => {
		if (!categoryId)
			categoryId = initialCategoryId ?? feeds.getNoCategoryId() ?? feeds.getCategories()[0]?.id ?? 0;
	});
	let saving = $state(false);

	const needsCategoryName = $derived(categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim());

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function handleSave() {
		if (!feedUrl.trim() || needsCategoryName) return;

		saving = true;
		try {
			const categoryIdToUse = categoryId === NEW_CATEGORY_SENTINEL
				? (await feeds.createCategory(newCategoryName.trim())).id
				: categoryId;
			const data: FeedCreate = {
				feed_url: feedUrl.trim(),
				category_id: categoryIdToUse,
			};
			await onsave(data);
			onclose();
		} catch {
			// Error shown by store
		} finally {
			saving = false;
		}
	}
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-40 bg-black/30" onclick={onclose}></div>

<div class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
	<div class="bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 pointer-events-auto">
		<div class="px-5 py-4 border-b border-n-200">
			<h2 class="text-lg font-semibold text-n-800">Add Feed</h2>
		</div>

		<form onsubmit={(e) => { e.preventDefault(); handleSave(); }} class="px-5 py-4 space-y-4">
			<div>
				<label for="add-feed-url" class="block text-sm font-medium text-n-700 mb-1">Feed URL</label>
				<input
					id="add-feed-url"
					type="url"
					bind:value={feedUrl}
					required
					placeholder="https://example.com/feed.xml"
					class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
			</div>

			<div>
				<label for="add-feed-category" class="block text-sm font-medium text-n-700 mb-1">Category</label>
				<CategorySelect id="add-feed-category" bind:value={categoryId} bind:newName={newCategoryName} />
			</div>

			<div class="flex items-center justify-between gap-2 pt-2">
				{#if onwizard}
					<button
						type="button"
						onclick={onwizard}
						class="text-xs text-a-600 underline hover:text-a-700"
					>
						Page has no RSS feed? Build one with RSS-Bridge
					</button>
				{:else}
					<span></span>
				{/if}
				<div class="flex gap-2">
					<button
						type="button"
						onclick={onclose}
						class="px-4 py-2 text-sm text-n-600 hover:bg-n-100 rounded-md"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={saving || !feedUrl.trim() || needsCategoryName}
						class="px-4 py-2 text-sm bg-a-600 text-white rounded-md hover:bg-a-700 disabled:opacity-50"
					>
						{saving ? 'Adding...' : 'Add'}
					</button>
				</div>
			</div>
		</form>
	</div>
</div>
