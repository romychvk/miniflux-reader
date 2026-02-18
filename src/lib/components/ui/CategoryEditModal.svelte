<script lang="ts">
	let { title: initialTitle, onclose, onsave }: {
		title: string;
		onclose: () => void;
		onsave: (title: string) => Promise<void>;
	} = $props();

	// svelte-ignore state_referenced_locally
	let title = $state(initialTitle);
	let saving = $state(false);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function handleSave() {
		const trimmed = title.trim();
		if (!trimmed || trimmed === initialTitle) {
			onclose();
			return;
		}
		saving = true;
		try {
			await onsave(trimmed);
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
	<div class="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 pointer-events-auto">
		<div class="px-5 py-4 border-b border-slate-200">
			<h2 class="text-lg font-semibold text-slate-800">Edit Category</h2>
		</div>

		<form onsubmit={(e) => { e.preventDefault(); handleSave(); }} class="px-5 py-4 space-y-4">
			<div>
				<label for="cat-title" class="block text-sm font-medium text-slate-700 mb-1">Title</label>
				<input
					id="cat-title"
					type="text"
					bind:value={title}
					class="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
				/>
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
					disabled={saving}
					class="px-4 py-2 text-sm bg-slate-700 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
				>
					{saving ? 'Saving...' : 'Save'}
				</button>
			</div>
		</form>
	</div>
</div>
