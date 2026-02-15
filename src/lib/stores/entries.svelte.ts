import { apiCall } from '$lib/api';
import type { Entry } from '$lib/types';
import { feeds } from './feeds.svelte';
import { ui } from './ui.svelte';

function createEntriesStore() {
	let entries = $state<Entry[]>([]);
	let loading = $state(false);
	let showAll = $state(false);

	async function loadEntries(apiPath: string) {
		loading = true;
		try {
			const sep = apiPath.includes('?') ? '&' : '?';
			const statusFilter = showAll ? '' : 'status=unread&';
			const data = await apiCall<{ total: number; entries: Entry[] }>(
				`${apiPath}${sep}${statusFilter}order=published_at&direction=desc&limit=100`
			);
			entries = data.entries || [];
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to load entries');
			entries = [];
		} finally {
			loading = false;
		}
	}

	function toggleShowAll() {
		showAll = !showAll;
	}

	async function markRead(entryIds: number[], read: boolean) {
		try {
			await apiCall('entries', {
				method: 'PUT',
				body: JSON.stringify({
					entry_ids: entryIds,
					status: read ? 'read' : 'unread'
				})
			});

			for (const id of entryIds) {
				const entry = entries.find((e) => e.id === id);
				if (entry) {
					const prevStatus = entry.status;
					entry.status = read ? 'read' : 'unread';
					if (prevStatus !== entry.status) {
						feeds.updateCounters(entry.feed.id, read ? -1 : 1);
					}
				}
			}
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to update status');
		}
	}

	async function fetchOriginalContent(entryId: number): Promise<string | null> {
		try {
			const data = await apiCall<{ content: string }>(`entries/${entryId}/original-content`);
			return data.content;
		} catch {
			return null;
		}
	}

	return {
		get entries() { return entries; },
		get loading() { return loading; },
		get showAll() { return showAll; },
		loadEntries,
		markRead,
		fetchOriginalContent,
		toggleShowAll
	};
}

export const entries = createEntriesStore();
