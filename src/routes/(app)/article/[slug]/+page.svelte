<script lang="ts">
	import { page } from '$app/state';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { apiCall } from '$lib/api';
	import { parseEntrySlugId } from '$lib/slug';
	import { enrichEntries, loadCoverRule } from '$lib/enrichment';
	import { requestArchive } from '$lib/imageArchiveClient';
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
			return;
		}

		// Fetch from API. Abort on re-run so a slow response for a previous article can't
		// overwrite a newer one when the slug changes faster than the request resolves.
		const controller = new AbortController();
		loading = true;
		apiCall<Entry>(`entries/${id}`, { signal: controller.signal }).then((raw) => {
			// An entry reached straight by URL — a middle-clicked tab, a bookmark, a shared link —
			// never passed through the list, so nothing had enriched it: no thumbnail, no preview
			// text, and no idea whether its feed archives images. Run the same pass the list runs,
			// then offer its images to the archive as a loaded page would.
			const [fetched] = enrichEntries([raw], loadCoverRule);
			if (fetched._imageUrls?.length) requestArchive(fetched._imageUrls);
			entry = fetched;
			ui.selectEntry(fetched);
			if (fetched.status === 'unread') {
				entries.markRead([fetched.id], true);
			}
		}).catch((e) => {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			ui.showError(e instanceof Error ? e.message : 'Failed to load article');
		}).finally(() => {
			if (!controller.signal.aborted) loading = false;
		});

		return () => controller.abort();
	});
</script>

{#if loading}
	<div class="flex items-center justify-center py-12">
		<Spinner />
	</div>
{:else if entry}
	<ArticleView {entry} />
{/if}
