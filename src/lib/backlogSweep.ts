import type { FilterRule } from './contentFilter';
import { asDedupMode, DEDUP_STORAGE_PREFIX, type DedupMode } from './dedup';
import { loadFilterAction, loadHideRules } from './filterHide';
import { storageGetString } from './storage';

// Miniflux's unread counters know nothing about what this reader takes out of a feed's list:
// "hide (mark read)" filter matches and collapsed duplicates both stay unread on the server, so
// a feed advertises 18 posts where the reader will show 2. The cure is to reconcile the feed's
// unread backlog — mark the invisible copies read — and this module decides which feeds that is
// worth doing for, and when.

export interface BacklogSettings {
	/** Client-side hide rules — empty unless the feed's filter action is 'mark-read'. */
	hideRules: FilterRule[];
	dedupMode: DedupMode;
}

export function loadBacklogSettings(feedId: number): BacklogSettings {
	return {
		hideRules: loadFilterAction(feedId) === 'mark-read' ? loadHideRules(feedId) : [],
		dedupMode: asDedupMode(storageGetString(DEDUP_STORAGE_PREFIX + feedId, 'off'))
	};
}

// Whether a feed shows fewer posts than its unread count claims.
export function reducesUnread(s: BacklogSettings): boolean {
	return s.hideRules.length > 0 || s.dedupMode !== 'off';
}

// Which feeds a background sweep has to touch: those whose unread count has moved since it last
// ran. Moved, not grown — the count drops as you read, so "grown" would measure arrivals against
// a high-water mark that reading never lowers: read ten posts, and the next five arrivals would
// sit unreconciled behind the old number. A count that hasn't budged has nothing new in it.
export function needsBacklogSweep(unread: number, lastSwept: number | undefined): boolean {
	return lastSwept === undefined ? unread > 0 : unread !== lastSwept;
}
