const domParser = new DOMParser();

const IMAGE_URL_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;

export function isImageUrl(url: string): boolean {
	if (!url) return false;
	try {
		return IMAGE_URL_RE.test(new URL(url, location.href).pathname);
	} catch {
		return IMAGE_URL_RE.test(url.split(/[?#]/)[0]);
	}
}

// A stable identity for an image URL, used to spot duplicates. When the path itself
// names an image file, the same picture is often re-requested at different sizes or
// formats via query params (`?w=900&q=90` vs `…&f=webp`) — so the path alone is the
// identity and the query is dropped. When the path is NOT an image file (a proxy/CDN
// that carries the real image in the query, e.g. `/resize?url=…`), the query is what
// distinguishes images, so the full URL is kept.
function imageKey(url: string): string {
	if (!url || url.startsWith('data:')) return url;
	try {
		const u = new URL(url, location.href);
		return IMAGE_URL_RE.test(u.pathname) ? u.origin + u.pathname : u.href;
	} catch {
		return url.split(/[?#]/)[0];
	}
}

// Whether article HTML already contains the given image (e.g. a cover/thumbnail), comparing
// by normalized key so the same picture counts as present even when the body requests it at a
// different size/format (`?w=900&q=90` vs `…&f=webp`). Used to avoid showing a separate cover
// above an article that already embeds it.
export function contentContainsImage(html: string, url: string): boolean {
	if (!html || !url) return false;
	const target = imageKey(url);
	const doc = domParser.parseFromString(html, 'text/html');
	for (const img of doc.querySelectorAll('img')) {
		if (imageKey(effectiveImageSrc(img)) === target) return true;
	}
	return false;
}

// The image an <img> effectively shows — its real src, falling back to the lazy-load
// attributes when src is a placeholder. Used to spot duplicates that render identically.
function effectiveImageSrc(img: Element): string {
	const src = img.getAttribute('src') || '';
	if (src && !src.startsWith('data:')) return src;
	const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
	return (
		img.getAttribute('data-src') ||
		img.getAttribute('data-original') ||
		img.getAttribute('data-lazy-src') ||
		srcset.split(',')[0]?.trim().split(/\s+/)[0] ||
		src
	);
}

// Many sites render galleries as `<a href="full.jpg"><img src="thumb-64x64.jpg"
// srcset="…" width="64" height="64"></a>` — the thumbnail is tiny and its size is
// hard-locked by width/height attributes (Tailwind preflight only sets max-width).
// The anchor's href is the real full-size image, so swap the <img> over to it and
// drop the size/srcset constraints. The anchor is kept so a click still opens the
// original.
function upgradeGalleryImages(doc: Document): boolean {
	let changed = false;
	for (const a of doc.querySelectorAll('a[href]')) {
		const href = a.getAttribute('href') || '';
		if (!isImageUrl(href)) continue;
		const img = a.querySelector('img');
		if (!img || img.getAttribute('src') === href) continue;
		img.setAttribute('src', href);
		img.removeAttribute('srcset');
		img.removeAttribute('sizes');
		img.removeAttribute('width');
		img.removeAttribute('height');
		changed = true;
	}
	return changed;
}

// Drop images that repeat one already shown earlier in the article. Lazy-load markup
// (and some feeds) emit the same picture twice — e.g. a real <img> plus a <noscript>
// fallback, or a thumbnail upgraded to the same full-size source as an inline copy.
// Empty <a>/<figure>/<picture> wrappers left behind are removed too.
function dedupeImages(doc: Document): boolean {
	const seen = new Set<string>();
	let changed = false;
	for (const img of doc.querySelectorAll('img')) {
		const key = imageKey(effectiveImageSrc(img));
		if (!key) continue;
		if (!seen.has(key)) {
			seen.add(key);
			continue;
		}
		const wrapper = img.closest('a, figure, picture');
		const container = wrapper && wrapper.querySelectorAll('img').length === 1 ? wrapper : img;
		container.remove();
		changed = true;
	}
	return changed;
}

// Render-time cleanup for article HTML: upgrade gallery thumbnails to their full-size
// image, then drop duplicate images. Covers every path that shows article content.
export function processArticleHtml(html: string): string {
	if (!html) return html;
	const doc = domParser.parseFromString(html, 'text/html');
	const upgraded = upgradeGalleryImages(doc);
	const deduped = dedupeImages(doc);
	return upgraded || deduped ? doc.body.innerHTML : html;
}
