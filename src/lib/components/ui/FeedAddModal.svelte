<script lang="ts">
	import type { Category, FeedCreate } from '$lib/types';

	let { categories, onclose, onsave }: {
		categories: Category[];
		onclose: () => void;
		onsave: (data: FeedCreate) => Promise<void>;
	} = $props();

	let feedUrl = $state('');
	let categoryId: number = $state(0);
	let crawler = $state(false);

	$effect(() => {
		if (!categoryId && categories.length) categoryId = categories[0].id;
	});
	let saving = $state(false);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function handleSave() {
		if (!feedUrl.trim()) return;

		saving = true;
		try {
			const data: FeedCreate = {
				feed_url: feedUrl.trim(),
				category_id: categoryId,
			};
			if (crawler) data.crawler = true;
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
	<div class="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 pointer-events-auto">
		<div class="px-5 py-4 border-b border-slate-200">
			<h2 class="text-lg font-semibold text-slate-800">Add Feed</h2>
		</div>

		<form onsubmit={(e) => { e.preventDefault(); handleSave(); }} class="px-5 py-4 space-y-4">
			<div>
				<label for="add-feed-url" class="block text-sm font-medium text-slate-700 mb-1">Feed URL</label>
				<input
					id="add-feed-url"
					type="url"
					bind:value={feedUrl}
					required
					placeholder="https://example.com/feed.xml"
					class="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
				/>
			</div>

			<div>
				<label for="add-feed-category" class="block text-sm font-medium text-slate-700 mb-1">Category</label>
				<select
					id="add-feed-category"
					bind:value={categoryId}
					class="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
				>
					{#each categories as cat}
						<option value={cat.id}>{cat.title}</option>
					{/each}
				</select>
			</div>

			<div class="flex items-center gap-2">
				<input
					id="add-feed-crawler"
					type="checkbox"
					bind:checked={crawler}
					class="rounded border-slate-300"
				/>
				<label for="add-feed-crawler" class="text-sm text-slate-700">Fetch original content (crawler)</label>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<button
					type="button"
					onclick={onclose}
					class="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={saving || !feedUrl.trim()}
					class="px-4 py-2 text-sm bg-slate-700 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
				>
					{saving ? 'Adding...' : 'Add'}
				</button>
			</div>
		</form>
	</div>
</div>
