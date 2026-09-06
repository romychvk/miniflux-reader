import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The store reads its directory from the environment at import time, so this has to be set before
// the module is pulled in — hence the dynamic import below rather than a top-level one.
const dir = await mkdtemp(join(tmpdir(), 'mfr-images-'));
process.env.IMAGE_ARCHIVE_DIR = dir;

// Prune is exercised against its own fresh directory further down, so it is imported there.
const { archiveKey, readImage, hasImage, writeImage } = await import(
	'../src/lib/server/imageStore.ts'
);

const JPEG = (size: number) =>
	Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(Math.max(0, size - 4))]);

after(async () => {
	await rm(dir, { recursive: true, force: true });
});

test('an archived image reads back byte-for-byte', async () => {
	const url = 'https://img.example.com/a.jpg?w=900&q=90';
	const bytes = JPEG(64);
	const key = archiveKey(url);

	assert.equal(await hasImage(key), false);
	await writeImage(key, bytes, 'image/jpeg', url);

	assert.equal(await hasImage(key), true);
	const got = await readImage(key);
	assert.ok(got);
	assert.equal(got.contentType, 'image/jpeg');
	assert.ok(got.bytes.equals(bytes));
});

test('archiveKey is stable and distinguishes urls that differ only in their query', async () => {
	const a = archiveKey('https://e.com/x.jpg?w=900');
	const b = archiveKey('https://e.com/x.jpg?w=1920');
	assert.notEqual(a, b);
	assert.equal(a, archiveKey('https://e.com/x.jpg?w=900'));
	assert.match(a, /^[0-9a-f]{64}$/);
});

test('a key that is not 64 hex is refused before it reaches a path', async () => {
	assert.equal(await readImage('../../etc/passwd'), null);
	assert.equal(await hasImage('../../etc/passwd'), false);
});

test('an unarchived key reads as null rather than throwing', async () => {
	assert.equal(await readImage(archiveKey('https://e.com/never-stored.jpg')), null);
});

// Metadata written under a rule we no longer accept must not be served: the type is what the GET
// hands the browser, and re-serving e.g. an SVG stored by an older build would be exactly the
// same-origin script problem the allowlist exists to prevent.
test('an image whose stored type is no longer allowed is refused', async () => {
	const url = 'https://e.com/legacy.svg';
	const key = archiveKey(url);
	await writeImage(key, JPEG(32), 'image/jpeg', url);
	await writeFile(
		join(dir, key.slice(0, 2), `${key}.json`),
		JSON.stringify({ url, contentType: 'image/svg+xml', size: 32, storedAt: Date.now() })
	);
	assert.equal(await readImage(key), null);
});

test('prune keeps the archive under budget, evicting oldest first', async () => {
	const fresh = await mkdtemp(join(tmpdir(), 'mfr-prune-'));
	process.env.IMAGE_ARCHIVE_DIR = fresh;
	const store = await import(`../src/lib/server/imageStore.ts?prune=${Date.now()}`);

	// Three 1000-byte images, written oldest-first with distinct timestamps.
	const urls = ['https://e.com/1.jpg', 'https://e.com/2.jpg', 'https://e.com/3.jpg'];
	for (const url of urls) {
		await store.writeImage(store.archiveKey(url), JPEG(1000), 'image/jpeg', url);
		await new Promise((r) => setTimeout(r, 5)); // storedAt is the sort key — keep them apart
	}

	const freed = await store.pruneArchive(2200); // room for two
	assert.equal(freed, 1000);
	assert.equal(await store.hasImage(store.archiveKey(urls[0])), false, 'oldest evicted');
	assert.equal(await store.hasImage(store.archiveKey(urls[1])), true);
	assert.equal(await store.hasImage(store.archiveKey(urls[2])), true);

	// Its metadata goes with it — a sidecar left behind would keep counting toward the budget.
	const shard = await readdir(join(fresh, store.archiveKey(urls[0]).slice(0, 2)));
	assert.equal(shard.includes(`${store.archiveKey(urls[0])}.json`), false);

	assert.equal(await store.pruneArchive(2200), 0, 'already under budget — nothing more to do');
	await rm(fresh, { recursive: true, force: true });
	process.env.IMAGE_ARCHIVE_DIR = dir;
});

test('prune on an empty archive is a no-op', async () => {
	const empty = await mkdtemp(join(tmpdir(), 'mfr-empty-'));
	process.env.IMAGE_ARCHIVE_DIR = empty;
	const store = await import(`../src/lib/server/imageStore.ts?empty=${Date.now()}`);
	assert.equal(await store.pruneArchive(10), 0);
	await rm(empty, { recursive: true, force: true });
	process.env.IMAGE_ARCHIVE_DIR = dir;
});
