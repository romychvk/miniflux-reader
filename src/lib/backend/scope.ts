import type { EntryScope } from '$lib/types';

// Pure helpers over EntryScope. Kept free of store imports so node:test can load them.

// The feed id of a single-feed scope, or null for the aggregate views (All, a category,
// Bookmarks) — the per-feed settings (hide rules, dedup) apply only to the former.
export function feedIdOf(scope: EntryScope): number | null {
	return scope.kind === 'feed' ? scope.id : null;
}
