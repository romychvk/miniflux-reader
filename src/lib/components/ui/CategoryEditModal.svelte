<script lang="ts">
	import { caps } from '$lib/backend';
	import { feeds } from '$lib/stores/feeds.svelte';
	import CategoryParentSelect from './CategoryParentSelect.svelte';

	// `categoryId` names the category being edited; with caps.nestedCategories the modal also
	// moves it (Parent), so a category can be nested without dragging — on a phone there is no drag.
	let { title: initialTitle, categoryId, onclose, onsave }: {
		title: string;
		categoryId?: number;
		onclose: () => void;
		onsave: (title: string, parentId: number | null) => Promise<void>;
	} = $props();

	// svelte-ignore state_referenced_locally
	let title = $state(initialTitle);
	// svelte-ignore state_referenced_locally
	const initialParentId = categoryId === undefined ? null : feeds.parentIdOf(categoryId);
	let parentId = $state<number | null>(initialParentId);
	let saving = $state(false);

	const nested = $derived(caps().nestedCategories && categoryId !== undefined && categoryId !== feeds.getNoCategoryId());
	// Said before Save: the server refuses a title a sibling under the chosen parent already has.
	const taken = $derived.by(() => {
		const t = title.trim();
		if (!t || categoryId === undefined || (t === initialTitle && parentId === initialParentId)) return false;
		return feeds.categoryTitleTaken(t, parentId, categoryId);
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function handleSave() {
		const trimmed = title.trim();
		if (taken) return;
		if (!trimmed || (trimmed === initialTitle && parentId === initialParentId)) {
			onclose();
			return;
		}
		saving = true;
		try {
			await onsave(trimmed, parentId);
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
<div class="fixed inset-0 z-40 bg-overlay/30" onclick={onclose}></div>

<div class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
	<div class="bg-surface rounded-lg shadow-xl w-full max-w-sm mx-4 pointer-events-auto">
		<div class="px-5 py-4 border-b border-n-200">
			<h2 class="text-lg font-semibold text-n-800">Edit Category</h2>
		</div>

		<form onsubmit={(e) => { e.preventDefault(); handleSave(); }} class="px-5 py-4 space-y-4">
			<div>
				<label for="cat-title" class="block text-sm font-medium text-n-700 mb-1">Title</label>
				<input
					id="cat-title"
					type="text"
					bind:value={title}
					class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
				{#if taken}
					<p class="mt-1 text-xs text-red-600">There is already a category with this name there.</p>
				{/if}
			</div>

			{#if nested}
				<div>
					<label for="cat-parent" class="block text-sm font-medium text-n-700 mb-1">Parent</label>
					<CategoryParentSelect id="cat-parent" bind:value={parentId} excludeId={categoryId} />
				</div>
			{/if}

			<div class="flex justify-end gap-2 pt-2">
				<button
					type="button"
					onclick={onclose}
					class="px-4 py-2 text-sm text-n-600 hover:bg-n-100 rounded-md"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={saving || taken}
					class="px-4 py-2 text-sm bg-a-600 text-on-accent rounded-md hover:bg-a-700 disabled:opacity-50"
				>
					{saving ? 'Saving...' : 'Save'}
				</button>
			</div>
		</form>
	</div>
</div>
