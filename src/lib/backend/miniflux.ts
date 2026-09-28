import { apiCall, authHeaders } from '$lib/api';
import { auth } from '$lib/stores/auth.svelte';
import { decodeContent } from '$lib/enrichment';
import type {
	Category,
	Entry,
	EntryScope,
	Feed,
	FeedCounters,
	FeedCreate,
	FeedIcon,
	FeedUpdate,
	FoundFeed
} from '$lib/types';
import { entriesPath, markAllReadPath } from './minifluxPaths';
import type { CurrentUser, EntryPage, EntryQuery, OpmlImportReport, ReaderBackend } from './types';

// Miniflux over its REST API, one method per endpoint the reader uses. Everything goes through
// the /api/proxy transport in $lib/api, which adds the credential headers.

// The current user id is only needed for the All view's mark-all-as-read; fetched once per
// token, so a logout/login as someone else cannot reuse the previous user's id.
let cachedUser: { token: string; id: number } | null = null;

async function currentUserId(): Promise<number> {
	if (cachedUser?.token !== auth.apiToken) {
		const me = await apiCall<{ id: number }>('me');
		cachedUser = { token: auth.apiToken, id: me.id };
	}
	return cachedUser.id;
}

export const minifluxBackend: ReaderBackend = {
	kind: 'miniflux',
	caps: { rssBridge: true, opml: true, serverHideRules: false },

	me(signal) {
		return apiCall<CurrentUser>('me', { signal });
	},
	// /v1/export answers with the OPML document itself, not JSON, so it bypasses apiCall's parse.
	async exportOpml() {
		const res = await fetch('/api/proxy/export', { headers: authHeaders() });
		if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
		return res.text();
	},
	// /v1/import takes the document as the body and answers {message}; Miniflux creates the
	// feeds, skips the ones already subscribed and fetches on its own schedule.
	async importOpml(xml): Promise<OpmlImportReport> {
		const r = await apiCall<{ message?: string }>('import', { method: 'POST', body: xml });
		return { message: r?.message ?? 'Feeds imported' };
	},

	listFeeds(signal) {
		return apiCall<Feed[]>('feeds', { signal });
	},
	listCategories(signal) {
		return apiCall<Category[]>('categories', { signal });
	},
	counters(signal) {
		return apiCall<FeedCounters>('feeds/counters', { signal });
	},
	feedIcon(feedId, signal) {
		return apiCall<FeedIcon>(`feeds/${feedId}/icon`, { signal });
	},
	createFeed(data: FeedCreate) {
		return apiCall<{ feed_id: number }>('feeds', { method: 'POST', body: JSON.stringify(data) });
	},
	async updateFeed(feedId, changes: FeedUpdate) {
		await apiCall(`feeds/${feedId}`, { method: 'PUT', body: JSON.stringify(changes) });
	},
	async deleteFeed(feedId) {
		await apiCall(`feeds/${feedId}`, { method: 'DELETE' });
	},
	async refreshFeed(feedId) {
		// PUT feeds/{id}/refresh is synchronous — it answers once the crawl is done. The bulk
		// PUT feeds/refresh is not (it returns before crawling), which is why the reader never
		// uses it and fans out per feed instead.
		await apiCall(`feeds/${feedId}/refresh`, { method: 'PUT' });
	},
	createCategory(title) {
		return apiCall<Category>('categories', { method: 'POST', body: JSON.stringify({ title }) });
	},
	async updateCategory(categoryId, title) {
		await apiCall(`categories/${categoryId}`, { method: 'PUT', body: JSON.stringify({ title }) });
	},

	async listEntries(scope: EntryScope, query: EntryQuery, signal): Promise<EntryPage> {
		const data = await apiCall<{ total?: number; entries?: Entry[] }>(entriesPath(scope, query), { signal });
		return { total: data.total ?? 0, entries: data.entries ?? [] };
	},
	getEntry(entryId, signal) {
		return apiCall<Entry>(`entries/${entryId}`, { signal });
	},
	async setStatus(entryIds, status) {
		await apiCall('entries', { method: 'PUT', body: JSON.stringify({ entry_ids: entryIds, status }) });
	},
	async markAllRead(scope) {
		const userId = scope.kind === 'all' ? await currentUserId() : 0;
		await apiCall(markAllReadPath(scope, userId), { method: 'PUT' });
	},
	async toggleBookmark(entryId) {
		// Takes no body and answers 204, flipping the flag server-side.
		await apiCall(`entries/${entryId}/bookmark`, { method: 'PUT' });
	},
	async fetchContent(entryId) {
		// fetch-content returns the re-scraped content but does not save it (as of 2.2.19), so it
		// is PUT back explicitly — decoded first, so what is stored is what the reader renders.
		const data = await apiCall<{ content: string }>(`entries/${entryId}/fetch-content`);
		const content = decodeContent(data.content || '');
		await apiCall(`entries/${entryId}`, { method: 'PUT', body: JSON.stringify({ content }) });
		return content;
	},

	async discover(pageUrl) {
		try {
			const res = await apiCall<FoundFeed[]>('discover', {
				method: 'POST',
				body: JSON.stringify({ url: pageUrl })
			});
			return Array.isArray(res) ? res : [];
		} catch {
			// Miniflux answers 404 when it finds nothing and 500 when it cannot fetch the page.
			// Both mean the same thing to the caller, which says so inline — no toast.
			return [];
		}
	}
};
