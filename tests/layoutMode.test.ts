import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	LAYOUT_MODES,
	migrateLegacyZen,
	parseLayoutMode,
	type LayoutMode
} from '../src/lib/layoutMode.ts';

test('parseLayoutMode round-trips every valid id', () => {
	for (const mode of LAYOUT_MODES) {
		assert.equal(parseLayoutMode(mode), mode);
	}
});

test('parseLayoutMode rejects anything else', () => {
	for (const bad of ['', 'zen-mode', 'twoColumn', 'ZEN', null, undefined]) {
		assert.equal(parseLayoutMode(bad), null, `${JSON.stringify(bad)} should not parse`);
	}
});

test('migrateLegacyZen folds the old boolean into the full-page pane', () => {
	assert.equal(migrateLegacyZen('two-column', 'true'), 'zen');
});

test('migrateLegacyZen keeps a split pane put — the placement wins over the stale flag', () => {
	// The contradiction the flag allowed: "Right of feeds" selected while articles opened full-page.
	// Resolving toward the pane restores what the radio always claimed.
	assert.equal(migrateLegacyZen('three-column', 'true'), 'three-column');
	assert.equal(migrateLegacyZen('expanded', 'true'), 'expanded');
});

test('migrateLegacyZen is a no-op without the flag', () => {
	for (const mode of LAYOUT_MODES) {
		for (const legacy of ['false', '', null, undefined]) {
			assert.equal(migrateLegacyZen(mode, legacy), mode);
		}
	}
});

test('migrateLegacyZen is idempotent once migrated', () => {
	const once: LayoutMode = migrateLegacyZen('two-column', 'true');
	assert.equal(migrateLegacyZen(once, 'true'), 'zen');
});
