import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	escapeRegex,
	rulePattern,
	toJsRegex,
	compileRules,
	parseRules,
	suggestFilterPhrase
} from '../src/lib/contentFilter.ts';

test('escapeRegex escapes regex metacharacters', () => {
	assert.equal(escapeRegex('a.b*c'), 'a\\.b\\*c');
	assert.equal(escapeRegex('[x](y)'), '\\[x\\]\\(y\\)');
});

test('rulePattern: contains → case-insensitive escaped, regex → verbatim', () => {
	assert.equal(rulePattern('contains', 'a.b'), '(?i)a\\.b');
	assert.equal(rulePattern('regex', 'a.b'), 'a.b');
});

test('toJsRegex lifts (?i) to the i flag and rejects bad/empty regex', () => {
	const re = toJsRegex('(?i)Hello');
	assert.ok(re && re.flags.includes('i') && re.test('hello'));
	assert.equal(toJsRegex(''), null);
	assert.equal(toJsRegex('('), null); // invalid syntax
	const plain = toJsRegex('foo');
	assert.ok(plain && !plain.flags.includes('i'));
});

test('compileRules emits field-scoped lines and skips empty values', () => {
	const c = compileRules([
		{ list: 'block', field: 'title', mode: 'contains', value: 'ad' },
		{ list: 'block', field: 'title', mode: 'contains', value: '   ' }, // skipped
		{ list: 'keep', field: 'url', mode: 'regex', value: '^https://good' }
	]);
	assert.equal(c.block_filter_entry_rules, 'EntryTitle=(?i)ad');
	assert.equal(c.keep_filter_entry_rules, 'EntryURL=^https://good');
});

test('parseRules round-trips field lines and migrates a legacy blocklist into Title rows', () => {
	const parsed = parseRules({ block_filter_entry_rules: 'EntryTitle=(?i)ad\nEntryURL=^x' });
	assert.equal(parsed.blockClean, true);
	assert.deepEqual(
		parsed.rules.find((r) => r.field === 'title'),
		{ list: 'block', field: 'title', mode: 'contains', value: 'ad' }
	);

	// A legacy (?i)-prefixed alternation of literals becomes one "contains" Title row per term.
	const legacy = parseRules({ blocklist_rules: '(?i)foo|bar' });
	assert.equal(legacy.hasLegacyBlock, true);
	assert.deepEqual(legacy.rules.map((r) => r.value).sort(), ['bar', 'foo']);
	assert.ok(legacy.rules.every((r) => r.field === 'title' && r.list === 'block'));

	// An unknown Miniflux field (EntryTag) can't be shown as a row → not clean.
	const raw = parseRules({ block_filter_entry_rules: 'EntryTag=news' });
	assert.equal(raw.blockClean, false);
});

test('suggestFilterPhrase trims to the text before an issue marker', () => {
	assert.equal(suggestFilterPhrase('Weekly News #42'), 'Weekly News');
	assert.equal(suggestFilterPhrase('Digest № 7'), 'Digest');
	assert.equal(suggestFilterPhrase('Foo Bar'), 'Foo Bar');
});
