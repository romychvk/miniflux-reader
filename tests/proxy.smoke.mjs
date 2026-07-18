// Integration smoke for the Miniflux proxy's SSRF pin, auth and method guards. The core check
// (isAllowedMinifluxServer) reads $env, so it can only be exercised against a running server.
// Requires a production build first: `pnpm build`. Then: `node tests/proxy.smoke.mjs`
// (or `pnpm test:proxy`). Spawns `node build` with ALLOWED_MINIFLUX_SERVER set, hits
// /api/proxy, asserts the security responses, and shuts the server down.
import { spawn } from 'node:child_process';

const PORT = 5199;
// A `.invalid` host never resolves, so a request that passes the pin fails upstream with 502 —
// which proves the pin let it through (rather than 403'ing it) without needing a real Miniflux.
const PIN = 'https://miniflux.invalid';
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['build'], {
	env: { ...process.env, PORT: String(PORT), ALLOWED_MINIFLUX_SERVER: PIN },
	stdio: 'ignore'
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(timeoutMs = 20000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			await fetch(`${BASE}/api/proxy/me`);
			return; // any HTTP response means the server is up
		} catch {
			await sleep(200);
		}
	}
	throw new Error('server did not become ready in time');
}

function shutdown() {
	try {
		server.kill();
	} catch {
		/* already gone */
	}
}

const auth = (server) => ({ 'x-miniflux-server': server, 'x-auth-token': 'dummy-token' });

const cases = [
	{ name: 'missing headers → 400', path: 'me', init: {}, expect: 400 },
	{
		name: 'mismatched server (SSRF attempt) → 403',
		path: 'me',
		init: { headers: auth('https://evil.invalid') },
		expect: 403
	},
	{
		name: 'pinned server passes the pin (unreachable upstream) → 502',
		path: 'me',
		init: { headers: auth(PIN) },
		expect: 502
	},
	{
		name: 'disallowed method → 405',
		path: 'me',
		init: { method: 'PATCH', headers: auth(PIN) },
		expect: 405
	}
];

let failed = 0;
try {
	await waitReady();
	for (const c of cases) {
		let status;
		try {
			status = (await fetch(`${BASE}/api/proxy/${c.path}`, c.init)).status;
		} catch (e) {
			status = `fetch error: ${e.message}`;
		}
		const ok = status === c.expect;
		if (!ok) failed++;
		console.log(`${ok ? '✔' : '✖'} ${c.name}  (got ${status})`);
	}
} catch (e) {
	console.error('smoke error:', e.message);
	failed++;
} finally {
	shutdown();
}

if (failed) {
	console.error(`\n${failed} proxy smoke case(s) failed`);
	process.exit(1);
}
console.log('\nproxy security smoke passed');
