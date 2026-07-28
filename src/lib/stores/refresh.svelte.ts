import type { FeedNode } from '$lib/types';
import {
	POLL_INTERVAL_MS,
	RESULT_HIDE_MS,
	computeNewCount,
	formatRefreshResult,
	isStale,
	shouldPoll
} from '$lib/refreshLogic';
import { auth } from './auth.svelte';
import { feeds } from './feeds.svelte';
import { entries } from './entries.svelte';
import { ui } from './ui.svelte';

function createRefreshStore() {
	let refreshing = $state(false);
	// '+N new' | 'No new' | 'Updated' — the pill shown after a manual refresh.
	let resultMessage = $state<string | null>(null);
	// Unread entries the background poll noticed for the selected context that the
	// visible list hasn't loaded yet; rendered as the clickable "+N new" chip.
	let pendingNew = $state(0);
	let resultTimeout: ReturnType<typeof setTimeout> | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let lastCheck = 0;

	// ui.selectedFeed can be a stale object after a tree rebuild; counters are written
	// onto the live tree nodes, so re-resolve before reading .unread. Bookmarks (-2)
	// has no counters — null.
	function liveCounterNode(): FeedNode | null {
		const sel = ui.selectedFeed;
		if (!sel || sel.id === -2) return null;
		return feeds.findFeedNodeById(sel.id, sel.isFeed);
	}

	function showResult(message: string) {
		resultMessage = message;
		if (resultTimeout) clearTimeout(resultTimeout);
		resultTimeout = setTimeout(() => { resultMessage = null; }, RESULT_HIDE_MS);
	}

	function dismissResult() {
		if (resultTimeout) clearTimeout(resultTimeout);
		resultTimeout = null;
		resultMessage = null;
	}

	function clearPending() {
		pendingNew = 0;
	}

	// Refresh whatever is selected: feed → that feed, category → its feeds, All →
	// every feed. Bookmarks just reloads the list — starring is a user action, no
	// server-side refresh can change it.
	async function refreshCurrent() {
		const sel = ui.selectedFeed;
		if (!sel || refreshing) return;
		refreshing = true;
		dismissResult();
		clearPending();
		try {
			if (sel.id === -2) {
				await entries.loadEntries(sel.apiPath);
				showResult('Updated');
			} else {
				// The count is "new unread fetched": cross-device reads or hide-rule
				// auto-marking between the snapshots can offset it, but unlike the
				// list-length delta it isn't capped by the loadEntries limit.
				const node = liveCounterNode();
				const before = node?.unread ?? 0;
				if (sel.isFeed) await feeds.refreshFeed(sel.id);
				else if (sel.id === -1) await feeds.refreshAllFeeds();
				else await feeds.refreshCategoryFeeds(sel.id);
				const after = node?.unread ?? 0; // refresh* already ran loadCounters()
				await entries.loadEntries(sel.apiPath);
				showResult(formatRefreshResult(computeNewCount(before, after)));
			}
		} catch {
			/* store methods already surfaced the error via ui.showError */
		} finally {
			refreshing = false;
			lastCheck = Date.now();
		}
	}

	// Entry point for the sidebar context menus. Refreshing the selected context gets
	// the full overlay UX; any other target keeps the silent behavior (refresh it, then
	// reload the visible list so an aggregate view picks up its new entries) — there is
	// no honest "+N new" number for a context that isn't on screen.
	async function refreshNode(node: FeedNode) {
		const sel = ui.selectedFeed;
		if (sel && sel.id === node.id && sel.isFeed === node.isFeed) {
			return refreshCurrent();
		}
		try {
			if (node.isFeed) await feeds.refreshFeed(node.id);
			else await feeds.refreshCategoryFeeds(node.id);
			if (ui.selectedFeed) await entries.loadEntries(ui.selectedFeed.apiPath);
		} catch {
			/* already handled */
		}
	}

	async function applyPending() {
		clearPending();
		if (ui.selectedFeed) await entries.loadEntries(ui.selectedFeed.apiPath);
	}

	function onSelectionChanged() {
		clearPending();
		dismissResult();
	}

	// The Miniflux daemon polls the sources itself on its own schedule — the frontend
	// only re-reads the cheap counters endpoint to notice what the server fetched.
	// Never reloads the entry list; new entries surface as the pendingNew chip.
	async function pollTick() {
		const guards = {
			hidden: document.hidden,
			refreshing,
			entriesLoading: entries.loading,
			loggedIn: auth.isLoggedIn,
			hasTree: feeds.feedTree.length > 0
		};
		if (!shouldPoll(guards)) return;
		const node = liveCounterNode();
		const before = node?.unread ?? 0;
		await feeds.loadCounters();
		lastCheck = Date.now();
		if (node) {
			const delta = node.unread - before;
			if (delta > 0) pendingNew += delta;
		}
	}

	function onVisibility() {
		if (!document.hidden && isStale(lastCheck, Date.now(), POLL_INTERVAL_MS)) void pollTick();
	}

	function startPolling() {
		if (pollTimer) return;
		// boot() just loaded fresh counters — the first interval tick is soon enough.
		lastCheck = Date.now();
		pollTimer = setInterval(() => { void pollTick(); }, POLL_INTERVAL_MS);
		document.addEventListener('visibilitychange', onVisibility);
	}

	function stopPolling() {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = null;
		document.removeEventListener('visibilitychange', onVisibility);
	}

	return {
		get refreshing() { return refreshing; },
		get resultMessage() { return resultMessage; },
		get pendingNew() { return pendingNew; },
		refreshCurrent,
		refreshNode,
		applyPending,
		onSelectionChanged,
		startPolling,
		stopPolling
	};
}

export const refresh = createRefreshStore();
