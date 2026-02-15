<script lang="ts">
	import { page } from '$app/state';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { apiCall } from '$lib/api';
	import { parseEntrySlugId } from '$lib/slug';
	import type { Entry } from '$lib/types';
	import ArticleView from '$lib/components/content/ArticleView.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';

	let entry = $state<Entry | null>(null);
	let loading = $state(true);

	$effect(() => {
		const slug = page.params.slug;
		const id = parseEntrySlugId(slug);
		if (id === null) return;

		// Try to find in already-loaded entries
		const existing = entries.findEntryById(id);
		if (existing) {
			entry = existing;
			loading = false;
			ui.selectEntry(existing);
			if (existing.status === 'unread') {
				entries.markRead([existing.id], true);
			}
		} else {
			// Fetch from API
			loading = true;
			apiCall<Entry>(`entries/${id}`).then((fetched) => {
				entry = fetched;
				ui.selectEntry(fetched);
				if (fetched.status === 'unread') {
					entries.markRead([fetched.id], true);
				}
			}).catch((e) => {
				ui.showError(e instanceof Error ? e.message : 'Failed to load article');
			}).finally(() => {
				loading = false;
			});
		}
	});
</script>

{#if loading}
	<div class="flex items-center justify-center py-12">
		<Spinner />
	</div>
{:else if entry}
	<ArticleView {entry} />
{/if}
