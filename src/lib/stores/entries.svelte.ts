import { apiCall } from '$lib/api';
import type { Entry } from '$lib/types';
import { feeds } from './feeds.svelte';
import { ui } from './ui.svelte';

function decodeContent(html: string): string {
	const trimmed = html.trim();
	if (trimmed.startsWith('&lt;') || (!trimmed.startsWith('<') && trimmed.includes('&lt;'))) {
		const ta = document.createElement('textarea');
		ta.innerHTML = html;
		return ta.value;
	}
	return html;
}

function extractThumbnail(content: string): string | null {
	const match = content.match(/<img[^>]+src=["']([^"']+)["']/);
	return match?.[1] ?? null;
}

function extractDescription(content: string): string {
	const doc = new DOMParser().parseFromString(content, 'text/html');
	const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
	return text.length > 150 ? text.slice(0, 150) + '...' : text;
}

function enrichEntries(entries: Entry[]): Entry[] {
	for (const entry of entries) {
		if (entry.content) {
			entry.content = decodeContent(entry.content);
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
	let searchQuery = $state('');
	let abortController: AbortController | null = null;

	async function loadEntries(apiPath: string) {
		abortController?.abort();
		abortController = new AbortController();
		const signal = abortController.signal;

		loading = true;
		try {
			const sep = apiPath.includes('?') ? '&' : '?';
			let params = '';
			if (searchQuery) {
				params = `search=${encodeURIComponent(searchQuery)}&`;
			} else if (!showAll) {
				params = 'status=unread&';
			}
			const data = await apiCall<{ total: number; entries: Entry[] }>(
				`${apiPath}${sep}${params}order=published_at&direction=desc&limit=100`,
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

	function setSearchQuery(query: string) {
		searchQuery = query;
	}

	function clearSearch() {
		searchQuery = '';
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
			return decodeContent(data.content);
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
		get searchQuery() { return searchQuery; },
		loadEntries,
		markRead,
		fetchOriginalContent,
		toggleShowAll,
		setSearchQuery,
		clearSearch,
		findEntryById
	};
}

export const entries = createEntriesStore();
