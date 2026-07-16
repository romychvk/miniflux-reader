// Export/import of the app's settings, which live only in this browser's localStorage
// (feed rules: rssbridge/dedup/cover, UI prefs, feed order, theme, AI config, and — opt-in —
// credentials). Regenerable caches are excluded. Lets you move settings between browsers/devices.

const CACHE_KEY_RE = /^(?:favicons|ogImages)/; // regenerable caches — not worth exporting
const SECRET_KEYS = ['miniflux_api_key', 'ai_api_key']; // gated behind "include tokens"

// Sync bookkeeping (rev/dirty/identity) is per-browser — it must never travel in a
// backup file or in the synced blob itself.
export const SYNC_META_PREFIX = 'settingsSync_';

// Keys that participate in server-side sync: everything except regenerable caches,
// secrets, the auth-bootstrap server URL, and the sync bookkeeping itself.
export function isSyncableKey(k: string): boolean {
	return (
		!CACHE_KEY_RE.test(k) &&
		!SECRET_KEYS.includes(k) &&
		k !== 'miniflux_server' &&
		!k.startsWith(SYNC_META_PREFIX)
	);
}

export interface SettingsBackup {
	app: 'miniflux-reader';
	type: 'settings';
	version: 1;
	exportedAt: string;
	data: Record<string, string>;
}

export function collectSettings(includeSecrets: boolean): Record<string, string> {
	const data: Record<string, string> = {};
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		if (!k || CACHE_KEY_RE.test(k) || k.startsWith(SYNC_META_PREFIX)) continue;
		if (!includeSecrets && SECRET_KEYS.includes(k)) continue;
		const v = localStorage.getItem(k);
		if (v !== null) data[k] = v;
	}
	return data;
}

export function exportSettings(includeSecrets: boolean): void {
	const payload: SettingsBackup = {
		app: 'miniflux-reader',
		type: 'settings',
		version: 1,
		exportedAt: new Date().toISOString(),
		data: collectSettings(includeSecrets)
	};
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `miniflux-reader-settings-${payload.exportedAt.slice(0, 10)}.json`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

// Apply a backup file's contents to localStorage (overwrites matching keys; leaves others —
// e.g. caches — intact). Returns the number of keys written. Throws on an invalid file.
export function importSettings(text: string): number {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error('Not a valid JSON file.');
	}
	const data = (parsed as Partial<SettingsBackup> | null)?.data;
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error('Unrecognized settings file.');
	}
	let count = 0;
	for (const [k, v] of Object.entries(data)) {
		if (typeof v === 'string' && !k.startsWith(SYNC_META_PREFIX)) {
			localStorage.setItem(k, v);
			count++;
		}
	}
	return count;
}
