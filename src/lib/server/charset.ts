import iconv from 'iconv-lite';

// Bytes → text for a fetched body (an article page, a listing page, JSON). Pages still come in
// KOI8-R (opennet.ru) and windows-1251, and the label can sit in several places that may
// disagree; the order below is the one that is right most often: a BOM is the bytes themselves,
// the HTTP header is what the server meant, an XML declaration or HTML <meta> is what the author
// meant, and UTF-8 is the modern default.

export function charsetFromContentType(contentType: string | undefined | null): string | null {
	const m = contentType?.match(/charset\s*=\s*"?([^";\s]+)/i);
	return m ? m[1].toLowerCase() : null;
}

export function charsetFromXmlDeclaration(head: string): string | null {
	const m = head.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i);
	return m ? m[1].toLowerCase() : null;
}

// <meta charset="koi8-r"> or <meta http-equiv="Content-Type" content="text/html; charset=koi8-r">.
// The HTML prescan reads the first 1024 bytes; a few pages put scripts first, so this reads more.
export function charsetFromHtmlMeta(head: string): string | null {
	const m = head.match(/<meta\b[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i);
	return m ? m[1].toLowerCase() : null;
}

function bomCharset(bytes: Uint8Array): { charset: string; skip: number } | null {
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { charset: 'utf-8', skip: 3 };
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { charset: 'utf-16le', skip: 2 };
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { charset: 'utf-16be', skip: 2 };
	return null;
}

export interface DecodedText {
	text: string;
	charset: string;
}

export function decodeTextBytes(bytes: Buffer, contentType?: string | null): DecodedText {
	const bom = bomCharset(bytes);
	let charset = bom?.charset ?? charsetFromContentType(contentType);
	const body = bom ? bytes.subarray(bom.skip) : bytes;
	if (!charset) {
		// The label is ASCII whatever the body's encoding (UTF-16 has a BOM by rule).
		const head = body.subarray(0, 4096).toString('latin1');
		charset = charsetFromXmlDeclaration(head) ?? charsetFromHtmlMeta(head) ?? 'utf-8';
	}
	// A <meta> naming UTF-16 on a byte-oriented page is a lie the HTML spec reads as UTF-8.
	if (!iconv.encodingExists(charset) || (charset.startsWith('utf-16') && !bom)) charset = 'utf-8';
	return { text: iconv.decode(body, charset), charset };
}
