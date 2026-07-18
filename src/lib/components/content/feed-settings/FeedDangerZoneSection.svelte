<script lang="ts">
	import type { Feed } from '$lib/types';
	import { Trash2 } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { feeds } from '$lib/stores/feeds.svelte';

	let { active, feed }: { active: boolean; feed: Feed } = $props();

	let confirmDelete = $state(false);
	let deleting = $state(false);

	async function unsubscribe() {
		deleting = true;
		try {
			await feeds.deleteFeed(feed.id);
			goto('/');
		} catch {
			deleting = false;
		}
	}
</script>

<section class:hidden={!active} class="rounded-lg border border-n-100 shadow-xl bg-surface p-5">
	<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-danger">Danger Zone</h3>
	{#if confirmDelete}
		<div class="flex flex-wrap items-center gap-3">
			<span class="text-sm text-n-700">Unsubscribe from <strong>{feed.title}</strong>? This removes the feed and all its entries.</span>
			<button
				type="button"
				onclick={unsubscribe}
				disabled={deleting}
				class="inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-sm text-on-accent hover:bg-danger-strong disabled:opacity-50"
			>
				<Trash2 class="h-3.5 w-3.5" />
				{deleting ? 'Unsubscribing…' : 'Yes, unsubscribe'}
			</button>
			<button
				type="button"
				onclick={() => (confirmDelete = false)}
				disabled={deleting}
				class="rounded-md px-3 py-1.5 text-sm text-n-600 hover:bg-n-100"
			>
				Cancel
			</button>
		</div>
	{:else}
		<button
			type="button"
			onclick={() => (confirmDelete = true)}
			class="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
		>
			<Trash2 class="h-3.5 w-3.5" />
			Unsubscribe
		</button>
	{/if}
</section>
