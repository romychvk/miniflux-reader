import type { Entry } from './types';
import { storageGet, storageGetString, storageSet } from './storage';
import { type FilterRule, type FilterField, rulePattern, toJsRegex } from './contentFilter';

// Per-feed "filter action" — what happens to entries matching the feed's filters:
//   'block'      → compile to Miniflux's server rules; matches are never downloaded (default).
//   'mark-read'  → keep the rules client-side (Miniflux downloads everything); this app marks
//                  matching entries read on load, so they drop out of the unread view but stay
//                  recoverable (visible in "show all", reversible by removing the rule).
// Miniflux has no "download but hide" rule, so 'mark-read' lives entirely in localStorage.

export type FilterAction = 'block' | 'mark-read';

export const FILTER_ACTION_PREFIX = 'filterAction:';
export const FILTER_HIDE_PREFIX = 'filterHideRules:';

export const FILTER_ACTION_OPTIONS: { value: FilterAction; label: string }[] = [
	{ value: 'block', label: "Don't download" },
	{ value: 'mark-read', label: 'Hide (mark read)' }
];

export function asFilterAction(raw: string | null | undefined): FilterAction {
	return raw === 'mark-read' ? 'mark-read' : 'block';
}

export function loadFilterAction(feedId: number): FilterAction {
	return asFilterAction(storageGetString(FILTER_ACTION_PREFIX + feedId, 'block'));
}

function isFilterRule(x: unknown): x is FilterRule {
	const r = x as FilterRule;
	return (
		!!r &&
		(r.list === 'block' || r.list === 'keep') &&
		(['title', 'content', 'url', 'author'] as FilterField[]).includes(r.field) &&
		(r.mode === 'contains' || r.mode === 'regex') &&
		typeof r.value === 'string'
	);
}

export function loadHideRules(feedId: number): FilterRule[] {
	const raw = storageGet<unknown>(FILTER_HIDE_PREFIX + feedId, []);
	return Array.isArray(raw) ? raw.filter(isFilterRule) : [];
}

export function saveHideRules(feedId: number, rules: FilterRule[]): void {
	storageSet(FILTER_HIDE_PREFIX + feedId, rules);
}

// Append a single block rule to a feed's client-side hide list (used by the quick action when the
// feed is in 'mark-read' mode), deduping an identical rule.
export function appendHideRule(feedId: number, rule: FilterRule): void {
	const rules = loadHideRules(feedId);
	if (
		!rules.some(
			(r) => r.list === rule.list && r.field === rule.field && r.mode === rule.mode && r.value === rule.value
		)
	) {
		rules.push(rule);
	}
	saveHideRules(feedId, rules);
}

// --- Client-side matching -----------------------------------------------------------------

export interface HideMatchers {
	block: { field: FilterField; re: RegExp }[];
	keep: { field: FilterField; re: RegExp }[];
}

// Precompile a rule set into regex matchers so a feed's entries can be tested cheaply. Rules
// whose regex JS can't compile are dropped (skipped client-side).
export function compileMatchers(rules: FilterRule[]): HideMatchers {
	const build = (list: 'block' | 'keep') =>
		rules
			.filter((r) => r.list === list && r.value.trim() !== '')
			.map((r) => ({ field: r.field, re: toJsRegex(rulePattern(r.mode, r.value)) }))
			.filter((m): m is { field: FilterField; re: RegExp } => m.re !== null);
	return { block: build('block'), keep: build('keep') };
}

function fieldValue(entry: Entry, field: FilterField): string {
	switch (field) {
		case 'title':
			return entry.title;
		case 'content':
			return entry.content;
		case 'url':
			return entry.url;
		case 'author':
			return entry.author;
	}
}

// Mirror Miniflux's block/keep semantics: an entry is hidden when any block rule matches, or when
// keep rules exist and none of them match.
export function isEntryHidden(entry: Entry, m: HideMatchers): boolean {
	if (m.block.some((x) => x.re.test(fieldValue(entry, x.field) ?? ''))) return true;
	if (m.keep.length > 0 && !m.keep.some((x) => x.re.test(fieldValue(entry, x.field) ?? ''))) return true;
	return false;
}
