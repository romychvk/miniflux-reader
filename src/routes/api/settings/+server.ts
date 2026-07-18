import type { RequestHandler } from './$types';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';

// Server-side settings store: one JSON blob per Miniflux user, so localStorage settings
// survive browser resets and follow the user across devices. The Miniflux API token is the
// identity — we resolve it to a user id via /v1/me and never store the token itself.

const DATA_DIR = env.SETTINGS_DATA_DIR || 'data';
// adapter-node rejects bodies over BODY_SIZE_LIMIT (512KB default) before we run;
// this route-level cap matters in `vite dev`, which doesn't enforce it.
const MAX_BYTES = 512 * 1024;
const AUTH_TTL_MS = 5 * 60_000;

const authCache = new Map<string, { userId: number; expires: number }>();

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

// Validates the caller's Miniflux credentials and maps them to a per-user storage path.
// Returns a Response on failure so handlers can bail with `if (x instanceof Response)`.
async function resolveFilePath(request: Request): Promise<string | Response> {
	const server = request.headers.get('x-miniflux-server')?.replace(/\/+$/, '');
	const token = request.headers.get('x-auth-token');

	if (!server || !token) {
		return json(400, { error: 'Missing server or token' });
	}

	const allowed = env.ALLOWED_MINIFLUX_SERVER?.replace(/\/+$/, '');
	if (allowed && server !== allowed) {
		return json(403, { error: 'Server not allowed' });
	}

	const cacheKey = `${server}|${token}`;
	const hit = authCache.get(cacheKey);
	let userId = hit && hit.expires > Date.now() ? hit.userId : undefined;

	if (userId === undefined) {
		let res: Response;
		try {
			res = await fetch(new URL('/v1/me', server), { headers: { 'X-Auth-Token': token } });
		} catch {
			return json(502, { error: 'Failed to reach Miniflux server' });
		}
		if (!res.ok) {
			return json(401, { error: 'Invalid credentials' });
		}
		const me = (await res.json()) as { id?: unknown };
		if (typeof me.id !== 'number') {
			return json(502, { error: 'Unexpected Miniflux response' });
		}
		userId = me.id;
		if (authCache.size > 100) authCache.clear();
		authCache.set(cacheKey, { userId, expires: Date.now() + AUTH_TTL_MS });
	}

	const name = createHash('sha256').update(`${server}|${userId}`).digest('hex');
	return join(DATA_DIR, `${name}.json`);
}

export const GET: RequestHandler = async ({ request }) => {
	const filePath = await resolveFilePath(request);
	if (filePath instanceof Response) return filePath;

	let raw: string;
	try {
		raw = await readFile(filePath, 'utf-8');
	} catch {
		return json(404, { error: 'No settings stored' });
	}

	try {
		JSON.parse(raw);
	} catch {
		console.error(`settings: corrupt blob at ${filePath}, treating as absent`);
		return json(404, { error: 'No settings stored' });
	}

	return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
};

export const PUT: RequestHandler = async ({ request }) => {
	const filePath = await resolveFilePath(request);
	if (filePath instanceof Response) return filePath;

	const body = await request.text();
	if (body.length > MAX_BYTES) {
		return json(413, { error: 'Settings blob too large' });
	}

	let parsed: { version?: unknown; data?: unknown };
	try {
		parsed = JSON.parse(body);
	} catch {
		return json(400, { error: 'Invalid JSON' });
	}

	const data = parsed?.data;
	if (
		parsed?.version !== 1 ||
		!data ||
		typeof data !== 'object' ||
		Array.isArray(data) ||
		!Object.values(data).every((v) => typeof v === 'string')
	) {
		return json(400, { error: 'Unrecognized settings payload' });
	}

	const rev = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
	const updatedAt = new Date().toISOString();
	const blob = JSON.stringify({ version: 1, rev, updatedAt, data });

	// Unique temp per write + atomic rename. A crash mid-write can't leave a truncated blob,
	// and — unlike a shared `${filePath}.tmp` — two concurrent PUTs from the same user (e.g. an
	// unload flush racing the boot push) no longer interleave into one temp file: each writes its
	// own, and rename() publishes a complete blob (last writer wins).
	const tmpPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		await mkdir(DATA_DIR, { recursive: true });
		await writeFile(tmpPath, blob, 'utf-8');
		await rename(tmpPath, filePath);
	} catch (e) {
		await unlink(tmpPath).catch(() => {});
		console.error('settings: write failed', e);
		return json(500, { error: 'Failed to store settings' });
	}

	return json(200, { rev, updatedAt });
};
