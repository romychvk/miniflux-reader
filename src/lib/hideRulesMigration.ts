import { appendFieldRule, compileRules, isFilterRule, type FilterRule } from './contentFilter';
import { FILTER_ACTION_PREFIX, FILTER_HIDE_PREFIX } from './filterHide';
import type { FeedUpdate } from './types';

// The one-time move of "hide (mark read)" rules out of localStorage into the feed's own rule
// fields, for an engine with caps.serverHideRules. Under Miniflux such a feed kept its rules
// client-side (filterAction:<id> = 'mark-read', filterHideRules:<id> = the rows) and its server
// fields empty; the engine applies the same grammar itself, so the rows compile into
// block/keep_filter_entry_rules and the local keys go. Pure: storage is read through `read`.

export interface LegacyHideRules {
	feedId: number;
	rules: FilterRule[];
}

export function collectLegacyHideRules(feedIds: number[], read: (key: string) => unknown): LegacyHideRules[] {
	const out: LegacyHideRules[] = [];
	for (const feedId of feedIds) {
		if (read(FILTER_ACTION_PREFIX + feedId) !== 'mark-read') continue;
		const raw = read(FILTER_HIDE_PREFIX + feedId);
		const rules = Array.isArray(raw) ? raw.filter(isFilterRule).filter((r) => r.value.trim() !== '') : [];
		if (rules.length > 0) out.push({ feedId, rules });
	}
	return out;
}

// The feed update that carries the rows over. The server fields are empty by construction for a
// mark-read feed; should one hold lines already (edited elsewhere), the rows are appended to them.
export function migrationChanges(rules: FilterRule[], current: { block_filter_entry_rules?: string; keep_filter_entry_rules?: string }): FeedUpdate {
	const compiled = compileRules(rules);
	const merge = (existing: string | undefined, list: 'block' | 'keep', lines: string) => {
		if (!existing?.trim()) return lines;
		let text = existing;
		for (const r of rules) if (r.list === list && r.value.trim()) text = appendFieldRule(text, r.field, r.value, r.mode);
		return text;
	};
	return {
		block_filter_entry_rules: merge(current.block_filter_entry_rules, 'block', compiled.block_filter_entry_rules),
		keep_filter_entry_rules: merge(current.keep_filter_entry_rules, 'keep', compiled.keep_filter_entry_rules)
	};
}

export function legacyKeys(feedId: number): string[] {
	return [FILTER_ACTION_PREFIX + feedId, FILTER_HIDE_PREFIX + feedId];
}
