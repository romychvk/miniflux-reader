import type { EntryScope } from '$lib/types';
import type { EntryQuery } from './types';

// The Miniflux REST paths behind the entries surface, as pure functions of the scope and query
// so they can be tested without the transport. Every entries endpoint takes the same query
// parameters; only the path prefix differs by scope, and Bookmarks is a flag on the plain
// `entries` collection rather than a collection of its own.

function entriesCollection(scope: EntryScope): string {
	switch (scope.kind) {
		case 'all':
			return 'entries';
		case 'starred':
			return 'entries?starred=true';
		case 'feed':
			return `feeds/${scope.id}/entries`;
		case 'category':
			return `categories/${scope.id}/entries`;
	}
}

export function entriesPath(scope: EntryScope, q: EntryQuery): string {
	const params: string[] = [];
	if (q.search) params.push(`search=${encodeURIComponent(q.search)}`);
	if (q.status) params.push(`status=${q.status}`);
	params.push(`order=${q.order ?? 'published_at'}`);
	params.push(`direction=${q.direction ?? 'desc'}`);
	params.push(`limit=${q.limit}`);
	if (q.offset) params.push(`offset=${q.offset}`);
	const base = entriesCollection(scope);
	return `${base}${base.includes('?') ? '&' : '?'}${params.join('&')}`;
}

// Miniflux's native mark-all-as-read endpoints: one per feed, per category, and per user for
// the All view (which is why the caller has to know its own user id there).
export function markAllReadPath(scope: Exclude<EntryScope, { kind: 'starred' }>, userId: number): string {
	switch (scope.kind) {
		case 'all':
			return `users/${userId}/mark-all-as-read`;
		case 'feed':
			return `feeds/${scope.id}/mark-all-as-read`;
		case 'category':
			return `categories/${scope.id}/mark-all-as-read`;
	}
}
