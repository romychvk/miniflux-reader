import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSyncableKey, SYNC_META_PREFIX } from '../src/lib/settingsBackup.ts';

// The security-critical contract of settings sync: which localStorage keys leave the browser.
// Secrets, per-browser bootstrap/meta and regenerable caches must NEVER be synced.

test('isSyncableKey excludes secrets, the bootstrap server URL, caches and sync meta', () => {
	const excluded = [
		'miniflux_api_key',
		'ai_api_key',
		'miniflux_server',
		'favicons',
		'ogImages_v5',
		'ogImages',
		SYNC_META_PREFIX + 'rev',
		SYNC_META_PREFIX + 'dirty',
		SYNC_META_PREFIX + 'identity'
	];
	for (const k of excluded) {
		assert.equal(isSyncableKey(k), false, `${k} must not sync`);
	}
});

test('isSyncableKey includes ordinary settings', () => {
	const synced = [
		'theme',
		'themeVars',
		'viewMode',
		'viewModesMap',
		'feedOrder',
		'categoryOrder',
		'showAll',
		'autoMarkReadOnScroll',
		'zenMode',
		'dedup:42',
		'coverRule:7',
		'filterAction:12'
	];
	for (const k of synced) {
		assert.equal(isSyncableKey(k), true, `${k} should sync`);
	}
});
