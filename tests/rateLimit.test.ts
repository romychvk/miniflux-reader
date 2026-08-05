import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/lib/server/rateLimit.ts';

const RULES = [
	{ prefix: '/api/ai', capacity: 3, refillPerMinute: 6 },
	{ prefix: '/api', capacity: 100, refillPerMinute: 100 }
];

test('allows up to capacity, then blocks with a Retry-After', () => {
	const rl = createRateLimiter(RULES);
	const t0 = 1_000_000;
	for (let i = 0; i < 3; i++) {
		assert.equal(rl.check('/api/ai', '1.2.3.4', t0).allowed, true, `request ${i + 1}`);
	}
	const blocked = rl.check('/api/ai', '1.2.3.4', t0);
	assert.equal(blocked.allowed, false);
	assert.ok(blocked.retryAfterSeconds >= 1);
});

test('tokens refill over time at the sustained rate', () => {
	const rl = createRateLimiter(RULES);
	const t0 = 1_000_000;
	for (let i = 0; i < 3; i++) rl.check('/api/ai', '1.2.3.4', t0);
	assert.equal(rl.check('/api/ai', '1.2.3.4', t0).allowed, false);
	// 6/min → one token every 10s.
	assert.equal(rl.check('/api/ai', '1.2.3.4', t0 + 11_000).allowed, true);
	assert.equal(rl.check('/api/ai', '1.2.3.4', t0 + 12_000).allowed, false);
});

test('buckets are per IP and per rule prefix', () => {
	const rl = createRateLimiter(RULES);
	const t0 = 1_000_000;
	for (let i = 0; i < 3; i++) rl.check('/api/ai', '1.2.3.4', t0);
	assert.equal(rl.check('/api/ai', '1.2.3.4', t0).allowed, false);
	assert.equal(rl.check('/api/ai', '5.6.7.8', t0).allowed, true, 'other IP unaffected');
	assert.equal(rl.check('/api/proxy/feeds', '1.2.3.4', t0).allowed, true, 'other prefix unaffected');
});

test('first matching rule wins and unmatched paths pass freely', () => {
	const rl = createRateLimiter(RULES);
	const t0 = 1_000_000;
	for (let i = 0; i < 3; i++) rl.check('/api/ai', '1.2.3.4', t0);
	// /api/ai exhausted, but the broad /api rule still has tokens — specific rule matched first.
	assert.equal(rl.check('/api/ai', '1.2.3.4', t0).allowed, false);
	for (let i = 0; i < 200; i++) rl.check('/login', '1.2.3.4', t0);
	assert.equal(rl.check('/login', '1.2.3.4', t0).allowed, true, 'no rule → no limit');
});

test('capacity is never exceeded after a long idle period', () => {
	const rl = createRateLimiter(RULES);
	const t0 = 1_000_000;
	rl.check('/api/ai', '1.2.3.4', t0);
	// After an hour, refill must clamp at capacity (3), not accumulate 360 tokens.
	const t1 = t0 + 60 * 60_000;
	for (let i = 0; i < 3; i++) {
		assert.equal(rl.check('/api/ai', '1.2.3.4', t1 + i).allowed, true);
	}
	assert.equal(rl.check('/api/ai', '1.2.3.4', t1 + 10).allowed, false);
});
