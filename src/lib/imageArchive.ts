import { storageGet } from '$lib/storage';

// Per-feed image archiving (client half; the store and endpoints live in $lib/server/imageStore
// and /api/images). A source can stop serving its pictures to us at any time — hotlink protection,
// a bot challenge, or plain link rot — and by then its articles are already unreadable. With
// archiving on, a feed's images are downloaded to our own server as its entries arrive and served
// back from there, so what we have stays readable whatever the source does later.
//
// It is per feed rather than global because the cost is real: every image of an archived feed is
// paid for twice, in our bandwidth and in our disk. Turn it on for the sources worth keeping.

export const ARCHIVE_STORAGE_PREFIX = 'archive:';

const ENDPOINT = '/api/images';

export function loadArchiveEnabled(feedId: number): boolean {
	return storageGet<boolean>(ARCHIVE_STORAGE_PREFIX + feedId, false) === true;
}

// Where the archived copy of a source image is served from. Content-addressed by the source URL
// on the server, so this stays a pure function of the URL — no lookup table to keep in sync.
export function archivedSrc(url: string): string {
	return `${ENDPOINT}?url=${encodeURIComponent(url)}`;
}

// True for a src this module produced. Accepts both the attribute we wrote and the absolute form
// the DOM hands back from `img.src`.
export function isArchivedSrc(src: string): boolean {
	if (!src) return false;
	const path = src.startsWith(ENDPOINT) ? src : src.replace(/^https?:\/\/[^/]+/i, '');
	return path.startsWith(`${ENDPOINT}?url=`);
}

// The source URL an archived src was built from, or null if this isn't one. Lets a failed archive
// read fall straight back to hotlinking the source, with no extra attribute to carry around.
export function originalFromArchivedSrc(src: string): string | null {
	if (!isArchivedSrc(src)) return null;
	const query = src.slice(src.indexOf('?') + 1);
	const value = new URLSearchParams(query).get('url');
	return value || null;
}

// Only http(s) images are worth archiving: a data: URI is already inline, and a protocol-relative
// or relative src has no absolute source to fetch.
export function isArchivableUrl(url: string | null | undefined): url is string {
	return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// Mirrors content.ts's isImageUrl deliberately rather than importing it: that module builds a
// DOMParser at import time, and keeping this one free of that keeps it unit-testable.
const IMAGE_URL_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp)(?:[?#]|$)/i;

// Every source image an entry shows: its thumbnail plus whatever the article body holds. The
// caller passes the already-parsed content document, so this costs no extra DOMParser pass.
//
// Gallery anchors (`<a href="full.jpg"><img src="thumb.jpg">`) contribute their href too, because
// by the time the article renders, upgradeGalleryImages has moved the <img> onto that full-size
// URL — archive only the thumbnail and the picture the reader actually opens would be the one
// missing from the archive.
export function collectImageUrls(doc: Document | null, thumbnailUrl?: string | null): string[] {
	const urls = new Set<string>();
	if (isArchivableUrl(thumbnailUrl)) urls.add(thumbnailUrl);
	if (doc) {
		for (const img of doc.querySelectorAll('img')) {
			const src = img.getAttribute('src');
			if (isArchivableUrl(src)) urls.add(src);
			const href = img.closest('a')?.getAttribute('href');
			if (isArchivableUrl(href) && IMAGE_URL_RE.test(href.split(/[?#]/)[0])) urls.add(href);
		}
	}
	return [...urls];
}

// Point an article's <img> tags at their archived copies. Runs on already-sanitized HTML: the only
// change is a src swap to a same-origin path, and originalFromArchivedSrc can decode the source
// back out of it, so nothing has to survive in a data-attribute the sanitizer would have to allow.
export function rewriteContentImages(html: string, parser: DOMParser): string {
	if (!html || !html.includes('<img')) return html;
	const doc = parser.parseFromString(html, 'text/html');
	let touched = false;
	for (const img of doc.querySelectorAll('img')) {
		const src = img.getAttribute('src');
		if (!isArchivableUrl(src)) continue;
		img.setAttribute('src', archivedSrc(src));
		// srcset would otherwise win over the src we just rewrote and go straight to the source.
		img.removeAttribute('srcset');
		touched = true;
	}
	return touched ? doc.body.innerHTML : html;
}
