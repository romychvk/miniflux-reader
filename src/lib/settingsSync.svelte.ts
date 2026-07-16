import { auth } from '$lib/stores/auth.svelte';
import { setStorageChangeListener } from '$lib/storage';
import { isSyncableKey, SYNC_META_PREFIX } from '$lib/settingsBackup';

// Keeps localStorage settings mirrored to /api/settings so they survive browser resets
// and follow the user across devices. Consistency model: the server stamps every stored
// blob with an opaque `rev`; this browser remembers the rev it last synced to plus a
// dirty flag. Revs are only ever compared for equality — no clocks, no ordering.
//
// Multi-tab is safe by construction: pushes snapshot the shared localStorage at push
// time and the meta keys are shared, so concurrent tabs converge on the same state.

const REV_KEY = `${SYNC_META_PREFIX}rev`;
const DIRTY_KEY = `${SYNC_META_PREFIX}dirty`;
const IDENTITY_KEY = `${SYNC_META_PREFIX}identity`;
const DEBOUNCE_MS = 2000;
const RETRY_MS = 30_000;

function createSettingsSync() {
	let lastSyncAt = $state<number | null>(null);
	let syncError = $state('');

	let suppress = false;
	let pushing = false;
	let pushQueued = false;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	function authHeaders(): Record<string, string> {
		return { 'X-Auth-Token': auth.apiToken, 'X-Miniflux-Server': auth.serverUrl };
	}

	function collectSyncable(): Record<string, string> {
		const data: Record<string, string> = {};
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k || !isSyncableKey(k)) continue;
			const v = localStorage.getItem(k);
			if (v !== null) data[k] = v;
		}
		return data;
	}

	async function sha256Hex(s: string): Promise<string> {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
		return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	async function push(opts: { keepalive?: boolean } = {}): Promise<void> {
		// Serialize pushes: an out-of-order response would store a stale rev locally.
		if (pushing) {
			pushQueued = true;
			return;
		}
		pushing = true;
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { ...authHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ version: 1, data: collectSyncable() }),
				keepalive: opts.keepalive
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const { rev } = (await res.json()) as { rev?: string };
			if (typeof rev === 'string') localStorage.setItem(REV_KEY, rev);
			localStorage.removeItem(DIRTY_KEY);
			lastSyncAt = Date.now();
			syncError = '';
		} catch (e) {
			// Dirty stays set — the next change, the 30s retry, or the next boot re-pushes.
			syncError = `Sync failed (${e instanceof Error ? e.message : 'network error'})`;
			retryTimer = setTimeout(() => {
				retryTimer = null;
				void push();
			}, RETRY_MS);
		} finally {
			pushing = false;
		}
		if (pushQueued) {
			pushQueued = false;
			void push();
		}
	}

	function onKeyChanged(key: string): void {
		if (suppress || !isSyncableKey(key)) return;
		try {
			localStorage.setItem(DIRTY_KEY, '1');
		} catch {
			// storage full/blocked — the debounced push still snapshots current state
		}
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			void push();
		}, DEBOUNCE_MS);
	}

	// Flushes a pending debounce immediately. keepalive lets the request outlive the page
	// on tab close (sendBeacon can't carry our auth headers; fetch keepalive can).
	function flush(): void {
		if (!debounceTimer) return;
		clearTimeout(debounceTimer);
		debounceTimer = null;
		void push({ keepalive: true });
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === 'hidden') flush();
	}

	// Boot-time reconciliation. Must run before any store hydrates from localStorage;
	// returns 'reloading' when server state was applied and the page is about to reload.
	async function syncOnBoot(): Promise<'continue' | 'reloading'> {
		try {
			// Account switch guard: leftover settings from a previous login must not be
			// pushed into (or mixed with) the new account's namespace.
			const identity = await sha256Hex(`${auth.serverUrl}|${auth.apiToken}`);
			const storedIdentity = localStorage.getItem(IDENTITY_KEY);
			if (storedIdentity && storedIdentity !== identity) {
				for (const k of Object.keys(collectSyncable())) localStorage.removeItem(k);
				localStorage.removeItem(REV_KEY);
				localStorage.removeItem(DIRTY_KEY);
			}
			localStorage.setItem(IDENTITY_KEY, identity);

			const res = await fetch('/api/settings', { headers: authHeaders() });

			if (res.status === 404) {
				// Nothing stored yet — seed the server from this browser.
				if (Object.keys(collectSyncable()).length > 0) await push();
				return 'continue';
			}
			if (!res.ok) {
				syncError = `Sync unavailable (HTTP ${res.status})`;
				return 'continue';
			}

			const blob = (await res.json()) as {
				version?: number;
				rev?: string;
				data?: Record<string, string>;
			};
			if (blob.version !== 1 || typeof blob.rev !== 'string' || !blob.data) {
				syncError = 'Sync unavailable (unexpected payload)';
				return 'continue';
			}

			const localRev = localStorage.getItem(REV_KEY);
			if (blob.rev === localRev) {
				if (localStorage.getItem(DIRTY_KEY)) await push();
				else {
					lastSyncAt = Date.now();
					syncError = '';
				}
				return 'continue';
			}

			// Server rev differs — server wins, even if dirty: dirty-at-boot means an
			// unflushed debounce from a stale session, while the server blob was pushed
			// deliberately since. Mirror the blob exactly (writes + deletions).
			suppress = true;
			let changed = false;
			const local = collectSyncable();
			for (const [k, v] of Object.entries(blob.data)) {
				if (!isSyncableKey(k)) continue; // a blob must not smuggle secrets or sync meta
				if (local[k] !== v) {
					localStorage.setItem(k, v);
					changed = true;
				}
			}
			for (const k of Object.keys(local)) {
				if (!(k in blob.data)) {
					localStorage.removeItem(k);
					changed = true;
				}
			}
			localStorage.setItem(REV_KEY, blob.rev);
			localStorage.removeItem(DIRTY_KEY);
			suppress = false;
			lastSyncAt = Date.now();
			syncError = '';

			if (changed) {
				// Some reads happen at module scope (cardAspect) or pre-boot (the anti-FOUC
				// themeVars script in app.html) — a reload is the only clean re-hydration.
				// Loop-safe: REV_KEY is already stored, so the next boot hits the rev-equal branch.
				location.reload();
				return 'reloading';
			}
			return 'continue';
		} catch (e) {
			suppress = false;
			syncError = `Sync unavailable (${e instanceof Error ? e.message : 'network error'})`;
			return 'continue';
		}
	}

	// Call after all store init()s so applying pulled data never echoes back as a push.
	// The listener and unload handlers intentionally live for the rest of the page's life.
	function start(): void {
		setStorageChangeListener(onKeyChanged);
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('pagehide', flush);
	}

	// Lets the import-backup flow mark restored settings for push on the post-reload boot.
	function markDirty(): void {
		try {
			localStorage.setItem(DIRTY_KEY, '1');
		} catch {
			// storage blocked — nothing to sync anyway
		}
	}

	return {
		get lastSyncAt() {
			return lastSyncAt;
		},
		get syncError() {
			return syncError;
		},
		syncOnBoot,
		start,
		flush,
		markDirty
	};
}

export const settingsSync = createSettingsSync();
