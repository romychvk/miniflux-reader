import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';

// The HMAC key behind every page-feed URL. PAGE_FEED_SECRET wins when set (so a redeploy onto a
// fresh volume keeps old feeds valid); otherwise one is generated on first use into the settings
// data dir — the same Docker volume that holds research.db, so it survives rebuilds.
//
// Losing or rotating the key 403s every page feed at once. Recovery is built into Feed Settings:
// Preview → Save re-signs a feed's URL with the current key.
//
// Lazy on purpose — importing this module has no side effects (svelte-check, dev boot), like the
// research DB singleton.

const KEY_FILE = 'page-feed.key';
const MIN_ENV_SECRET = 16;

let cached: string | null = null;

export function getPageFeedSecret(): string {
	if (cached) return cached;

	const fromEnv = env.PAGE_FEED_SECRET?.trim();
	if (fromEnv && fromEnv.length >= MIN_ENV_SECRET) return (cached = fromEnv);

	const dir = env.SETTINGS_DATA_DIR || 'data';
	const path = join(dir, KEY_FILE);
	try {
		const existing = readFileSync(path, 'utf8').trim();
		if (existing) return (cached = existing);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}

	mkdirSync(dir, { recursive: true });
	const fresh = randomBytes(32).toString('hex');
	try {
		// 'wx' + 0600: never clobber a key another worker just wrote, and keep it owner-only.
		writeFileSync(path, fresh, { flag: 'wx', mode: 0o600 });
		return (cached = fresh);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
			return (cached = readFileSync(path, 'utf8').trim());
		}
		throw e;
	}
}

// Where signed feed URLs point. adapter-node derives url.origin from the Host header (https://
// behind Traefik), which is right in prod; PAGE_FEED_PUBLIC_ORIGIN overrides it for a dev tunnel.
export function pageFeedPublicOrigin(requestUrl: URL): string {
	const configured = env.PAGE_FEED_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '');
	return configured || requestUrl.origin;
}
