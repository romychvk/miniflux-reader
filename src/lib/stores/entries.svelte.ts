import { apiCall } from '$lib/api';
import type { Entry } from '$lib/types';
import { feeds } from './feeds.svelte';
import { ui } from './ui.svelte';

function extractThumbnail(content: string): string | null {
	const match = content.match(/<img[^>]+src=["']([^"']+)["']/);
	return match?.[1] ?? null;
}

function extractDescription(content: string): string {
	const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 150 ? text.slice(0, 150) + '...' : text;
}

function enrichEntries(entries: Entry[]): Entry[] {
	for (const entry of entries) {
		if (entry.content) {
			entry._thumbnailUrl = extractThumbnail(entry.content);
			entry._description = extractDescription(entry.content);
		} else {
			entry._thumbnailUrl = null;
			entry._description = '';
		}
	}
	return entries;
}

function createEntriesStore() {
	let entries = $state<Entry[]>([]);
	let loading = $state(false);
	let showAll = $state(false);
	let abortController: AbortController | null = null;

	async function loadEntries(apiPath: string) {
		abortController?.abort();
		abortController = new AbortController();
		const signal = abortController.signal;

		loading = true;
		try {
			const sep = apiPath.includes('?') ? '&' : '?';
			const statusFilter = showAll ? '' : 'status=unread&';
			const data = await apiCall<{ total: number; entries: Entry[] }>(
				`${apiPath}${sep}${statusFilter}order=published_at&direction=desc&limit=100`,
				{ signal }
			);
			entries = enrichEntries(data.entries || []);
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			ui.showError(e instanceof Error ? e.message : 'Failed to load entries');
			entries = [];
		} finally {
			if (!signal.aborted) loading = false;
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

	function findEntryById(id: number): Entry | null {
		return entries.find(e => e.id === id) ?? null;
	}

	return {
		get entries() { return entries; },
		get loading() { return loading; },
		get showAll() { return showAll; },
		loadEntries,
		markRead,
		fetchOriginalContent,
		toggleShowAll,
		findEntryById
	};
}

export const entries = createEntriesStore();
