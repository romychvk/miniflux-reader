// What the image archive is willing to store, and how it decides. Split out of imageStore so it
// stays free of $env and filesystem imports — this is the part worth unit-testing.

// Raster only, deliberately. An SVG is a document: it can carry <script>, and archived bytes are
// served from our OWN origin, so an attacker-controlled SVG would be stored XSS with full
// same-origin reach. Feed images are raster in practice, so refusing SVG costs nothing.
export const ALLOWED_IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/avif'
]);

// A key only ever comes from archiveKey(), but it also arrives from a request, so re-check the
// shape before it reaches a path join — 64 hex characters can't traverse anywhere.
export function isValidKey(key: string): boolean {
	return /^[0-9a-f]{64}$/.test(key);
}

// The declared type has to be one we allow AND the bytes have to actually look like it. The second
// half matters more than it sounds: a bot-challenge page or an error page served under an image
// content-type would otherwise be archived as if it were the picture, and the reader would then
// cache that failure forever — which is the exact opposite of what the archive is for.
export function sniffImageType(bytes: Buffer, contentType: string | null): string | null {
	const declared = (contentType ?? '').split(';')[0].trim().toLowerCase();
	if (!ALLOWED_IMAGE_TYPES.has(declared)) return null;
	if (bytes.length < 12) return null;

	const at = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');

	let actual: string | null = null;
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) actual = 'image/jpeg';
	else if (at(0, 8) === '\x89PNG\r\n\x1a\n') actual = 'image/png';
	else if (at(0, 6) === 'GIF87a' || at(0, 6) === 'GIF89a') actual = 'image/gif';
	else if (at(0, 4) === 'RIFF' && at(8, 12) === 'WEBP') actual = 'image/webp';
	// AVIF is ISO-BMFF: a length prefix, then 'ftyp', then a brand such as avif/avis.
	else if (at(4, 8) === 'ftyp' && at(8, 12).startsWith('avi')) actual = 'image/avif';

	return actual === declared ? declared : null;
}
