const domParser = new DOMParser();

const IMAGE_URL_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;

function isImageUrl(url: string): boolean {
	if (!url) return false;
	try {
		return IMAGE_URL_RE.test(new URL(url, location.href).pathname);
	} catch {
		return IMAGE_URL_RE.test(url.split(/[?#]/)[0]);
	}
}

// Many sites render galleries as `<a href="full.jpg"><img src="thumb-64x64.jpg"
// srcset="…" width="64" height="64"></a>` — the thumbnail is tiny and its size is
// hard-locked by width/height attributes (Tailwind preflight only sets max-width).
// The anchor's href is the real full-size image, so swap the <img> over to it and
// drop the size/srcset constraints. The anchor is kept so a click still opens the
// original. Runs at render time, covering every path that shows article content.
export function upgradeGalleryImages(html: string): string {
	if (!html || !html.includes('<a')) return html;
	const doc = domParser.parseFromString(html, 'text/html');
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
	return changed ? doc.body.innerHTML : html;
}
