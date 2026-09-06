import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	archivedSrc,
	isArchivableUrl,
	isArchivedSrc,
	originalFromArchivedSrc
} from '../src/lib/imageArchive.ts';
import { isValidKey, sniffImageType } from '../src/lib/server/imageTypes.ts';

// --- archived src round-trip ------------------------------------------------------------
// The source URL is carried inside the archive URL rather than in a data-attribute, so the
// encode/decode pair is the only thing keeping the "archive missed → hotlink the source"
// fallback working. A URL with its own query is the case that breaks a naive implementation.

test('archivedSrc round-trips a plain url', () => {
	const url = 'https://img.example.com/a/b.jpg';
	assert.equal(originalFromArchivedSrc(archivedSrc(url)), url);
});

test('archivedSrc round-trips a url carrying its own query', () => {
	const url = 'https://img.mezha.ua/mezha/images/doc/3/3/x.jpeg?w=900&q=90&f=webp';
	const src = archivedSrc(url);
	// the source's own &q= must not read as a second parameter of ours
	assert.equal(new URLSearchParams(src.slice(src.indexOf('?') + 1)).get('q'), null);
	assert.equal(originalFromArchivedSrc(src), url);
});

test('archivedSrc round-trips urls with spaces, plus signs and non-ascii', () => {
	for (const url of [
		'https://e.com/a b.jpg',
		'https://e.com/a+b.jpg',
		'https://e.com/зображення.png',
		'https://e.com/x.jpg?t=a%2Bb&u=1#frag'
	]) {
		assert.equal(originalFromArchivedSrc(archivedSrc(url)), url, url);
	}
});

test('isArchivedSrc accepts our attribute and the absolute form the DOM reports', () => {
	const rel = archivedSrc('https://e.com/a.jpg');
	assert.equal(isArchivedSrc(rel), true);
	assert.equal(isArchivedSrc(`https://reader.example.com${rel}`), true);
});

test('isArchivedSrc rejects anything we did not build', () => {
	for (const src of ['', 'https://e.com/a.jpg', '/api/og-image?url=x', 'data:image/png;base64,AA']) {
		assert.equal(isArchivedSrc(src), false, src);
	}
	assert.equal(originalFromArchivedSrc('https://e.com/a.jpg'), null);
});

test('isArchivableUrl takes only absolute http(s)', () => {
	assert.equal(isArchivableUrl('https://e.com/a.jpg'), true);
	assert.equal(isArchivableUrl('http://e.com/a.jpg'), true);
	for (const bad of ['//e.com/a.jpg', '/local.jpg', 'data:image/png;base64,AA', '', null, undefined]) {
		assert.equal(isArchivableUrl(bad), false, String(bad));
	}
});

// --- what the archive agrees to store ---------------------------------------------------

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const PNG = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.alloc(8)
]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(8)]);
const WEBP = Buffer.concat([
	Buffer.from('RIFF', 'latin1'),
	Buffer.alloc(4),
	Buffer.from('WEBP', 'latin1')
]);
const AVIF = Buffer.concat([
	Buffer.alloc(4),
	Buffer.from('ftyp', 'latin1'),
	Buffer.from('avif', 'latin1')
]);

test('sniffImageType accepts bytes that match their declared type', () => {
	assert.equal(sniffImageType(JPEG, 'image/jpeg'), 'image/jpeg');
	assert.equal(sniffImageType(PNG, 'image/png'), 'image/png');
	assert.equal(sniffImageType(GIF, 'image/gif'), 'image/gif');
	assert.equal(sniffImageType(WEBP, 'image/webp'), 'image/webp');
	assert.equal(sniffImageType(AVIF, 'image/avif'), 'image/avif');
	assert.equal(sniffImageType(JPEG, 'image/jpeg; charset=binary'), 'image/jpeg');
});

// The whole point of the byte check: a blocked source answers with an HTML challenge page, and
// nothing stops it labelling that as an image. Archiving it would cache the failure forever.
test('sniffImageType refuses a challenge page dressed as an image', () => {
	const html = Buffer.from('<!DOCTYPE html><html><head><title>Just a moment...', 'latin1');
	assert.equal(sniffImageType(html, 'image/jpeg'), null);
	assert.equal(sniffImageType(html, 'text/html'), null);
});

test('sniffImageType refuses a type/bytes mismatch either way round', () => {
	assert.equal(sniffImageType(PNG, 'image/jpeg'), null);
	assert.equal(sniffImageType(JPEG, 'image/png'), null);
});

test('sniffImageType refuses svg, which would be same-origin script', () => {
	const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'latin1');
	assert.equal(sniffImageType(svg, 'image/svg+xml'), null);
});

test('sniffImageType refuses a missing content-type and a too-short body', () => {
	assert.equal(sniffImageType(JPEG, null), null);
	assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'), null);
});

test('isValidKey takes only a 64-char lowercase hex digest', () => {
	assert.equal(isValidKey('a'.repeat(64)), true);
	for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '../etc/passwd', '']) {
		assert.equal(isValidKey(bad), false, bad);
	}
});
