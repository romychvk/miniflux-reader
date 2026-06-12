import { apiCall } from '$lib/api';
import type { Entry } from '$lib/types';
import { storageGet, storageGetString, storageSet } from '$lib/storage';
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

const domParser = new DOMParser();

function isPlaceholderUrl(url: string): boolean {
	if (!url) return true;
	if (url.startsWith('data:')) return true; // inline svg/gif placeholders
	return /(?:^|[/_-])(?:1x1|pixel|spacer|blank|placeholder|loader|loading|tracking)(?:[._-]|$)/i.test(url);
}

// The card thumbnail is the first "real" image in the content. Modern sites lazy-load
// images (real URL in data-src/srcset, a placeholder in src), so check those too and
// skip tracking pixels / tiny spacers — otherwise the card looks image-less.
function extractThumbnail(content: string): string | null {
	const doc = domParser.parseFromString(content, 'text/html');
	for (const img of doc.querySelectorAll('img')) {
		const w = parseInt(img.getAttribute('width') || '', 10);
		const h = parseInt(img.getAttribute('height') || '', 10);
		if ((w && w <= 2) || (h && h <= 2)) continue; // tracking pixel

		const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
		const firstFromSrcset = srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';

		for (const candidate of [
			img.getAttribute('src') || '',
			img.getAttribute('data-src') || '',
			img.getAttribute('data-original') || '',
			img.getAttribute('data-lazy-src') || '',
			firstFromSrcset
		]) {
			if (candidate && !isPlaceholderUrl(candidate)) return candidate;
		}
	}
	return null;
}

function extractDescription(content: string): string {
	const doc = domParser.parseFromString(content, 'text/html');
	for (const br of doc.querySelectorAll('br, p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote')) {
		br.before(' ');
	}
	const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
	return text.length > 150 ? text.slice(0, 150) + '...' : text;
}

// An image attached to the RSS item itself (enclosure / media:content / media:thumbnail —
// Miniflux maps all of these to `enclosures`). A free thumbnail source when the content
// has no usable <img>.
function imageEnclosure(entry: Entry): string | null {
	const enc = entry.enclosures?.find((e) => e.url && e.mime_type?.startsWith('image/'));
	return enc?.url ?? null;
}

// Best thumbnail without any extra network request: first real content image, else the
// RSS image enclosure. The og:image fallback (a network call) is handled lazily by
// ensureThumbnail() only when both of these come up empty.
function pickThumbnail(entry: Entry): string | null {
	return (entry.content ? extractThumbnail(entry.content) : null) ?? imageEnclosure(entry);
}

function enrichEntries(entries: Entry[]): Entry[] {
	for (const entry of entries) {
		if (entry.content) entry.content = decodeContent(entry.content);
		entry._thumbnailUrl = pickThumbnail(entry);
		entry._description = entry.content ? extractDescription(entry.content) : '';
	}
	return entries;
}

// --- og:image fallback (lazy, cached, bounded concurrency) ---------------------------
const OG_CACHE_KEY = 'ogImages';
const SHOW_ALL_KEY = 'showAll';
const OG_MAX_CONCURRENT = 4;
let ogCache: Record<string, string> | null = null; // url -> image url ('' = checked, none)
const ogInFlight = new Set<string>();
let ogActive = 0;
const ogQueue: (() => void)[] = [];

function ogSchedule(task: () => Promise<void>): void {
	const run = () => {
		ogActive++;
		task().finally(() => {
			ogActive--;
			ogQueue.shift()?.();
		});
	};
	if (ogActive < OG_MAX_CONCURRENT) run();
	else ogQueue.push(run);
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

	function initShowAll() {
		showAll = storageGetString(SHOW_ALL_KEY) === 'true';
	}

	function toggleShowAll() {
		showAll = !showAll;
		storageSet(SHOW_ALL_KEY, String(showAll));
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

	// Re-scrape the original page (applying the feed's scraper/rewrite rules) and
	// persist it. Miniflux's fetch-content endpoint returns the content but does not
	// save it (as of 2.2.19), so we PUT it back explicitly.
	async function fetchAndStore(entryId: number): Promise<string> {
		const data = await apiCall<{ content: string }>(`entries/${entryId}/fetch-content`);
		const content = decodeContent(data.content || '');
		await apiCall(`entries/${entryId}`, {
			method: 'PUT',
			body: JSON.stringify({ content })
		});
		const entry = entries.find((e) => e.id === entryId);
		if (entry) {
			entry.content = content;
			entry._thumbnailUrl = extractThumbnail(content) ?? imageEnclosure(entry);
			entry._description = extractDescription(content);
		}
		return content;
	}

	// Fill in a missing thumbnail from the article's og:image. Lazy and cached: invoked
	// per row from the UI only for image views, runs at most once per article URL, and
	// negative results are cached too (so we don't re-hit pages that have no og:image).
	function ensureThumbnail(entry: Entry): void {
		if (entry._thumbnailUrl || !entry.url) return;
		if (ogCache === null) ogCache = storageGet<Record<string, string>>(OG_CACHE_KEY, {});

		const cached = ogCache[entry.url];
		if (cached !== undefined) {
			if (cached) entry._thumbnailUrl = cached;
			return;
		}
		if (ogInFlight.has(entry.url)) return;
		ogInFlight.add(entry.url);

		ogSchedule(async () => {
			let image = '';
			try {
				const res = await fetch(`/api/og-image?url=${encodeURIComponent(entry.url)}`);
				if (res.ok) image = (await res.json())?.url || '';
			} catch {
				/* leave uncached so a later view can retry */
			} finally {
				ogInFlight.delete(entry.url);
			}
			ogCache![entry.url] = image;
			storageSet(OG_CACHE_KEY, ogCache);
			if (image) {
				const target = entries.find((e) => e.id === entry.id) ?? entry;
				if (!target._thumbnailUrl) target._thumbnailUrl = image;
			}
		});
	}

	async function refetchContent(entryId: number): Promise<string | null> {
		try {
			return await fetchAndStore(entryId);
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'Failed to re-fetch content');
			return null;
		}
	}

	// Re-fetch content for the latest N entries of a feed, with bounded concurrency to
	// avoid hammering the source site. Useful after changing feed rules. The status
	// filter should match what the user is viewing so the visible list updates in place.
	async function refetchFeedLatest(
		feedId: number,
		limit: number,
		status: 'unread' | 'all',
		onProgress?: (done: number, total: number) => void
	): Promise<{ total: number; ok: number; failed: number }> {
		const statusParam = status === 'unread' ? 'status=unread&' : '';
		const data = await apiCall<{ entries: Entry[] }>(
			`feeds/${feedId}/entries?${statusParam}order=published_at&direction=desc&limit=${limit}`
		);
		const ids = (data.entries || []).map((e) => e.id);
		const total = ids.length;
		let ok = 0;
		let failed = 0;
		let done = 0;
		let cursor = 0;

		async function worker() {
			while (cursor < ids.length) {
				const id = ids[cursor++];
				try {
					await fetchAndStore(id);
					ok++;
				} catch {
					failed++;
				}
				onProgress?.(++done, total);
			}
		}

		await Promise.all(Array.from({ length: Math.min(4, ids.length) }, () => worker()));
		return { total, ok, failed };
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
		refetchContent,
		refetchFeedLatest,
		initShowAll,
		toggleShowAll,
		setSearchQuery,
		clearSearch,
		findEntryById,
		ensureThumbnail
	};
}

export const entries = createEntriesStore();
