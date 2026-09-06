import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { ALLOWED_IMAGE_TYPES, isValidKey } from './imageTypes';

// Content-addressed store for archived feed images, living in a Docker volume beside the settings
// blobs. It exists because a source can stop serving its pictures to us at any time — hotlink
// protection, a bot challenge, or plain link rot — and by then the article is already unreadable.
// Archiving a feed downloads its images once, while they are still reachable, and serves them back
// from our own origin afterwards. Serving them ourselves also sidesteps Cross-Origin-Resource-Policy,
// which is what blocks embedding even when a fetch would have succeeded.
//
// Layout: <dir>/<first 2 hex of key>/<key> for the bytes, plus <key>.json for the metadata. The
// fan-out keeps any single directory small; the sidecar avoids an index file that could drift out
// of sync with what is actually on disk (the files ARE the index — `prune` just reads them).

const ARCHIVE_DIR = env.IMAGE_ARCHIVE_DIR || 'data/images';

export interface ArchivedImage {
	bytes: Buffer;
	contentType: string;
}

export interface ImageMeta {
	url: string;
	contentType: string;
	size: number;
	storedAt: number;
}

export function archiveKey(url: string): string {
	return createHash('sha256').update(url).digest('hex');
}

function pathsFor(key: string): { dir: string; blob: string; meta: string } {
	const dir = join(ARCHIVE_DIR, key.slice(0, 2));
	return { dir, blob: join(dir, key), meta: join(dir, `${key}.json`) };
}

export async function readImage(key: string): Promise<ArchivedImage | null> {
	if (!isValidKey(key)) return null;
	const { blob, meta } = pathsFor(key);
	try {
		const [bytes, metaRaw] = await Promise.all([readFile(blob), readFile(meta, 'utf-8')]);
		const parsed = JSON.parse(metaRaw) as ImageMeta;
		const contentType = ALLOWED_IMAGE_TYPES.has(parsed.contentType) ? parsed.contentType : null;
		if (!contentType) return null; // stored under an older/looser rule — refuse to serve it
		return { bytes, contentType };
	} catch {
		return null; // absent, unreadable, or corrupt metadata — all mean "not archived"
	}
}

export async function hasImage(key: string): Promise<boolean> {
	if (!isValidKey(key)) return false;
	try {
		await stat(pathsFor(key).blob);
		return true;
	} catch {
		return false;
	}
}

// Written via a temp file + rename so a crash mid-write can never leave a half-image that later
// reads would happily serve. The blob lands before the metadata, and readImage needs both, so the
// worst interleaving yields "not archived" rather than a truncated picture.
export async function writeImage(
	key: string,
	bytes: Buffer,
	contentType: string,
	url: string
): Promise<void> {
	const { dir, blob, meta } = pathsFor(key);
	await mkdir(dir, { recursive: true });
	const tmp = `${blob}.${process.pid}.tmp`;
	await writeFile(tmp, bytes);
	await rename(tmp, blob);
	const record: ImageMeta = { url, contentType, size: bytes.length, storedAt: Date.now() };
	await writeFile(meta, JSON.stringify(record));
	if (knownTotal !== null) knownTotal += bytes.length;
}

// Running total of what the archive holds, so the usual "still well under budget" answer costs no
// I/O at all. Null until something establishes it; a full scan sets it, and each write adds to it.
// It can drift (an overwrite double-counts, another process could write), but only ever upward,
// and the next scan replaces it with the truth — so drift makes pruning eager, never lax.
let knownTotal: number | null = null;

// Oldest-first eviction once the archive outgrows its budget. Called after a batch rather than on
// a timer: the archive only grows when something was just written, so that is the only moment the
// cap can be crossed. Best-effort — a failure to prune must never fail the archiving request.
//
// The early return matters at a realistic budget: a scan reads a metadata sidecar for every image
// held, which at tens of thousands of files is far too much work to repeat after each batch.
export async function pruneArchive(maxBytes: number): Promise<number> {
	if (knownTotal !== null && knownTotal <= maxBytes) return 0;

	const entries: { key: string; size: number; storedAt: number }[] = [];
	let total = 0;
	let shards: string[];
	try {
		shards = await readdir(ARCHIVE_DIR);
	} catch {
		return 0; // nothing archived yet
	}
	for (const shard of shards) {
		let names: string[];
		try {
			names = await readdir(join(ARCHIVE_DIR, shard));
		} catch {
			continue;
		}
		for (const name of names) {
			if (!isValidKey(name)) continue; // skip the .json sidecars and any stray temp file
			try {
				const raw = await readFile(join(ARCHIVE_DIR, shard, `${name}.json`), 'utf-8');
				const m = JSON.parse(raw) as ImageMeta;
				entries.push({ key: name, size: m.size, storedAt: m.storedAt });
				total += m.size;
			} catch {
				continue;
			}
		}
	}
	knownTotal = total;
	if (total <= maxBytes) return 0;

	entries.sort((a, b) => a.storedAt - b.storedAt);
	let freed = 0;
	for (const e of entries) {
		if (total - freed <= maxBytes) break;
		const { blob, meta } = pathsFor(e.key);
		try {
			await unlink(blob);
			await unlink(meta);
			freed += e.size;
		} catch {
			// already gone, or held open — either way it isn't ours to worry about
		}
	}
	knownTotal = total - freed;
	return freed;
}
