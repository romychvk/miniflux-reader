<script lang="ts">
	import { ui } from '$lib/stores/ui.svelte';
	import { X } from 'lucide-svelte';
</script>

<div class="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
	{#if ui.successMessage}
		<div class="max-w-sm bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
			<span class="text-sm flex-1">{ui.successMessage}</span>
			<button onclick={() => ui.clearSuccess()} class="shrink-0 hover:opacity-80">
				<X size={16} />
			</button>
		</div>
	{/if}
	{#if ui.errorMessage}
		<div class="max-w-sm bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
			<span class="text-sm flex-1">{ui.errorMessage}</span>
			<button onclick={() => ui.clearError()} class="shrink-0 hover:opacity-80">
				<X size={16} />
			</button>
		</div>
	{/if}
</div>
