import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectLegacyHideRules, legacyKeys, migrationChanges } from '../src/lib/hideRulesMigration.ts';

const store: Record<string, unknown> = {
	'filterAction:1': 'mark-read',
	'filterHideRules:1': [
		{ list: 'block', field: 'title', mode: 'contains', value: 'sponsored' },
		{ list: 'keep', field: 'content', mode: 'regex', value: 'ukr' },
		{ list: 'block', field: 'title', mode: 'contains', value: '   ' }, // empty: dropped
		{ list: 'block', field: 'tags', mode: 'contains', value: 'x' } // invalid: dropped
	],
	'filterAction:2': 'block', // rules already on the server
	'filterHideRules:2': [{ list: 'block', field: 'title', mode: 'contains', value: 'old' }],
	'filterAction:3': 'mark-read', // nothing to carry
	'filterHideRules:3': [],
	'filterAction:4': 'mark-read',
	'filterHideRules:4': 'junk'
};
const read = (key: string) => store[key] ?? null;

test('only mark-read feeds with valid rules are collected', () => {
	const legacy = collectLegacyHideRules([1, 2, 3, 4, 5], read);
	assert.deepEqual(legacy, [
		{
			feedId: 1,
			rules: [
				{ list: 'block', field: 'title', mode: 'contains', value: 'sponsored' },
				{ list: 'keep', field: 'content', mode: 'regex', value: 'ukr' }
			]
		}
	]);
	assert.deepEqual(legacyKeys(1), ['filterAction:1', 'filterHideRules:1']);
});

test('the rows compile into the feed fields, appended to lines already there', () => {
	const rules = collectLegacyHideRules([1], read)[0].rules;
	assert.deepEqual(migrationChanges(rules, {}), {
		block_filter_entry_rules: 'EntryTitle=(?i)sponsored',
		keep_filter_entry_rules: 'EntryContent=ukr'
	});
	const merged = migrationChanges(rules, { block_filter_entry_rules: 'EntryTitle=(?i)sponsored\nEntryURL=(?i)promo' });
	assert.equal(merged.block_filter_entry_rules, 'EntryTitle=(?i)sponsored\nEntryURL=(?i)promo');
	assert.equal(merged.keep_filter_entry_rules, 'EntryContent=ukr');
});
