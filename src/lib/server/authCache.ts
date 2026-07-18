import { createHash } from 'node:crypto';

// Per-user validation cache shared by the endpoints that resolve a Miniflux token to a user id
// (the helper-endpoint auth gate and the settings store). Two hardening properties:
//
//  - The Map key is a SHA-256 of `${server}|${token}`, never the raw token, so a memory dump of
//    the cache can't recover live API tokens. The token is high-entropy, so preimage resistance
//    makes the hash a dead end (no salt/HMAC needed for a guessable-password style attack).
//  - Expired entries are pruned on every write, so a stream of distinct tokens can't pile up for
//    the full TTL; the size cap is only a backstop against a burst of concurrent live sessions.

export function hashAuthKey(server: string, token: string): string {
	return createHash('sha256').update(`${server}|${token}`).digest('hex');
}

export function createAuthCache(ttlMs: number, maxEntries = 100) {
	const store = new Map<string, { userId: number; expires: number }>();

	return {
		// The cached user id for these credentials, or undefined if absent/expired.
		get(server: string, token: string, now: number = Date.now()): number | undefined {
			const hit = store.get(hashAuthKey(server, token));
			return hit && hit.expires > now ? hit.userId : undefined;
		},
		set(server: string, token: string, userId: number, now: number = Date.now()): void {
			for (const [k, v] of store) if (v.expires <= now) store.delete(k);
			if (store.size >= maxEntries) store.clear();
			store.set(hashAuthKey(server, token), { userId, expires: now + ttlMs });
		},
		get size(): number {
			return store.size;
		}
	};
}
