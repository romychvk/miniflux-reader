<script lang="ts">
	import { ui } from '$lib/stores/ui.svelte';
	import { X } from 'lucide-svelte';
</script>

{#if ui.errorMessage}
	<div class="fixed bottom-4 right-4 z-50 max-w-sm bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
		<span class="text-sm flex-1">{ui.errorMessage}</span>
		<button onclick={() => ui.clearError()} class="shrink-0 hover:opacity-80">
			<X size={16} />
		</button>
	</div>
{/if}
