// Pure decision logic for the refresh UI, kept out of the runes store so it can
// run under `node --test` (rune calls don't resolve outside the Svelte compiler).

// How often the background poll re-reads feeds/counters while the tab is visible.
export const POLL_INTERVAL_MS = 5 * 60_000;
// How long the "+N new" / "No new" result pill stays up after a manual refresh.
export const RESULT_HIDE_MS = 3000;

// Counters can shrink between snapshots (reads on another device), so clamp at 0.
export function computeNewCount(before: number, after: number): number {
	return Math.max(0, after - before);
}

export function formatRefreshResult(newCount: number): string {
	return newCount > 0 ? `+${newCount} new` : 'No new';
}

export function isStale(lastCheck: number, now: number, intervalMs: number): boolean {
	return now - lastCheck >= intervalMs;
}

export interface PollGuards {
	hidden: boolean;
	refreshing: boolean;
	entriesLoading: boolean;
	loggedIn: boolean;
	hasTree: boolean;
}

// One gate for a background tick: skip when the tab is hidden, a manual refresh or
// list load is underway, the user is logged out, or the feed tree isn't built yet.
export function shouldPoll(g: PollGuards): boolean {
	return !g.hidden && !g.refreshing && !g.entriesLoading && g.loggedIn && g.hasTree;
}
