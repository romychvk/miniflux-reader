// Per-IP token-bucket rate limiting for the API surface. In-memory on purpose: the app runs as
// a single adapter-node process, so no shared store is needed. Buckets idle for 10+ minutes are
// swept on the fly to keep the map bounded.
//
// First matching rule wins — order specific prefixes before broad ones.

export interface RateLimitRule {
	prefix: string;
	capacity: number; // burst size
	refillPerMinute: number; // sustained rate
}

export interface RateLimitVerdict {
	allowed: boolean;
	retryAfterSeconds: number;
}

interface Bucket {
	tokens: number;
	last: number;
}

const SWEEP_INTERVAL_MS = 60_000;
const IDLE_EVICT_MS = 10 * 60_000;

export function createRateLimiter(rules: RateLimitRule[]) {
	const buckets = new Map<string, Bucket>();
	let lastSweep = 0;

	function check(pathname: string, ip: string, now: number = Date.now()): RateLimitVerdict {
		const rule = rules.find((r) => pathname.startsWith(r.prefix));
		if (!rule) return { allowed: true, retryAfterSeconds: 0 };

		if (now - lastSweep > SWEEP_INTERVAL_MS) {
			for (const [key, b] of buckets) {
				if (now - b.last > IDLE_EVICT_MS) buckets.delete(key);
			}
			lastSweep = now;
		}

		const key = `${rule.prefix}|${ip}`;
		const bucket = buckets.get(key) ?? { tokens: rule.capacity, last: now };
		bucket.tokens = Math.min(
			rule.capacity,
			bucket.tokens + ((now - bucket.last) / 60_000) * rule.refillPerMinute
		);
		bucket.last = now;

		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			buckets.set(key, bucket);
			return { allowed: true, retryAfterSeconds: 0 };
		}

		buckets.set(key, bucket);
		return {
			allowed: false,
			retryAfterSeconds: Math.max(1, Math.ceil(((1 - bucket.tokens) / rule.refillPerMinute) * 60))
		};
	}

	return { check };
}
