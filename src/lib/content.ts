const domParser = new DOMParser();

const IMAGE_URL_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;

// Elements that render their own visual content. Used to tell a truly blank wrapper (safe
// to drop, or safe to pull into a paragraph) from one that only looks empty of text
// because its payload is media.
const MEDIA_SELECTOR = 'img, iframe, video, audio, embed, object, svg, picture, canvas';

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

// Drop blank spacer paragraphs — `<p>&nbsp;</p>`, `<p>   </p>`, `<p><br></p>` and the
// like that scraped sites scatter for vertical spacing. `p:empty` can't match these (a
// `&nbsp;` or blank text node isn't "empty" to CSS), so test the normalized text here:
// trim() already discards regular whitespace and `&nbsp;`, and we also strip zero-width
// characters. Paragraphs carrying media (an image, an embed) are kept even without text.
function dropEmptyParagraphs(doc: Document): boolean {
	let changed = false;
	for (const p of doc.querySelectorAll('p')) {
		if (p.querySelector(MEDIA_SELECTOR)) continue;
		if (p.textContent?.replace(/[\u200b-\u200d\ufeff]/g, '').trim()) continue;
		p.remove();
		changed = true;
	}
	return changed;
}

// Inline formatting tags that are pure garbage when they hold nothing — scraped pages
// leave empty `<var></var>`, `<span></span>` and the like behind. Only removed when truly
// empty (no child elements, no text), so `<span><img></span>` and `<b>x</b>` are safe.
const EMPTY_INLINE_TAGS = 'var, span, b, i, em, strong, u, s, small, mark, sub, sup, code, font, big, tt, abbr';

function dropEmptyInlineTags(doc: Document): boolean {
	let changed = false;
	// Reverse document order so an inner empty element is removed before its parent, which
	// may then become empty itself (e.g. `<b><i></i></b>`).
	for (const el of [...doc.querySelectorAll(EMPTY_INLINE_TAGS)].reverse()) {
		if (el.children.length === 0 && !el.textContent?.trim()) {
			el.remove();
			changed = true;
		}
	}
	return changed;
}

// Elements that stand on their own as blocks — used as separators when wrapping loose
// content, so a run of inline text ends wherever one of these begins.
const BLOCK_TAGS = new Set([
	'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
	'BLOCKQUOTE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'FIGURE',
	'FIGCAPTION', 'HR', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'FORM',
	'FIELDSET', 'ADDRESS', 'DETAILS', 'MAIN', 'HGROUP', 'IMG', 'PICTURE', 'IFRAME', 'VIDEO',
	'AUDIO', 'EMBED', 'OBJECT', 'CANVAS'
]);

// Whether a node should stay as its own block rather than be pulled into a wrapping <p>.
// True for block elements and standalone media, and for inline wrappers that carry only
// media (`<a><img></a>`) — the article CSS targets those directly, so leave them be.
function isBlockNode(node: Node): boolean {
	if (node.nodeType !== Node.ELEMENT_NODE) return false;
	const el = node as Element;
	if (BLOCK_TAGS.has(el.nodeName)) return true;
	return !!el.querySelector(MEDIA_SELECTOR) && !el.textContent?.trim();
}

// Some feeds emit article bodies as bare text and inline tags with no block wrappers — the
// content starts mid-sentence with no <p>, so prose spacing never applies (and sometimes
// no <p> ever appears). Wrap each run of loose text/inline nodes in a <p>, using block
// elements and standalone media as separators; <br> and whitespace stay inside the run.
// Runs holding only <br>/whitespace are left alone. Well-formed articles whose top-level
// children are already block-level are untouched.
function wrapLooseInlineContent(doc: Document): boolean {
	// Descend through single block wrappers (`<div><div>…loose text…`) to the element that
	// actually holds the loose content.
	let container: Element = doc.body;
	while (
		container.children.length === 1 &&
		['DIV', 'SECTION', 'ARTICLE'].includes(container.firstElementChild!.nodeName) &&
		![...container.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
	) {
		container = container.firstElementChild!;
	}

	const isBlank = (n: Node) => n.nodeType === Node.TEXT_NODE && !n.textContent?.trim();
	let changed = false;
	let group: Node[] = [];
	const flush = () => {
		while (group.length && isBlank(group[group.length - 1])) group.pop(); // trailing whitespace
		const meaningful = group.some(
			(n) =>
				(n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) ||
				(n.nodeType === Node.ELEMENT_NODE && n.nodeName !== 'BR')
		);
		if (meaningful) {
			const p = doc.createElement('p');
			container.insertBefore(p, group[0]);
			for (const n of group) p.appendChild(n);
			changed = true;
		}
		group = [];
	};

	for (const node of [...container.childNodes]) {
		if (isBlockNode(node)) flush(); // boundary — close the current run
		else if (node.nodeType === Node.COMMENT_NODE) continue;
		else if (isBlank(node) && group.length === 0) continue; // skip whitespace between blocks
		else group.push(node);
	}
	flush();
	return changed;
}

// Render-time cleanup for article HTML: upgrade gallery thumbnails to their full-size
// image, drop duplicate images, strip empty inline tags, wrap loose bare text in
// paragraphs, then drop blank spacer paragraphs. Covers every path that shows content.
export function processArticleHtml(html: string): string {
	if (!html) return html;
	const doc = domParser.parseFromString(html, 'text/html');
	const upgraded = upgradeGalleryImages(doc);
	const deduped = dedupeImages(doc);
	const inlineStripped = dropEmptyInlineTags(doc);
	const wrapped = wrapLooseInlineContent(doc);
	const trimmed = dropEmptyParagraphs(doc);
	return upgraded || deduped || inlineStripped || wrapped || trimmed ? doc.body.innerHTML : html;
}
