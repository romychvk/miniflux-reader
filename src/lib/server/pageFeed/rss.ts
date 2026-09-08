import { createHash } from 'node:crypto';
import type { ExtractedItem } from './extract';

// RSS 2.0 rather than Atom: pubDate is legitimately optional there, and listing pages often
// have no dates. Miniflux stamps a dateless item with the time it first saw it and dedupes on
// the guid (= article URL), so dateless items neither duplicate nor drift.
//
// The body carries no timestamps of its own, so identical extraction → identical bytes → a
// stable ETag, and Miniflux's conditional GET gets a 304 when nothing changed.

export interface RssChannel {
	title: string;
	link: string;
	description: string;
	selfUrl: string;
}

// XML 1.0 forbids most C0 controls outright; scraped text can carry them. Go's decoder (Miniflux)
// rejects the whole document over one, so strip rather than escape.
const ILLEGAL_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

export function escapeXml(text: string): string {
	return text
		.replace(ILLEGAL_XML, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

// RFC 822 as RSS wants it ("Thu, 12 Mar 2026 11:00:00 GMT"); null for anything unparseable.
export function toRfc822(iso: string): string | null {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d.toUTCString();
}

// The description is HTML *inside* XML text: escape the HTML once for its own text nodes, then
// the whole fragment gets escaped again as XML by the caller.
function itemDescription(item: ExtractedItem): string {
	// A section carries its own markup — already HTML, so it needs no escaping of its own here and
	// gets exactly the one XML pass the caller applies. It replaces the summary rather than joining
	// it: the summary is that same section flattened to text.
	if (item.content) return item.content;
	const parts: string[] = [];
	if (item.image) parts.push(`<p><img src="${escapeXml(item.image)}" alt=""></p>`);
	if (item.summary) parts.push(`<p>${escapeXml(item.summary)}</p>`);
	return parts.join('');
}

export function buildRss(channel: RssChannel, items: ExtractedItem[]): string {
	const e = escapeXml;
	const lines: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
		'<channel>',
		`<title>${e(channel.title)}</title>`,
		`<link>${e(channel.link)}</link>`,
		`<description>${e(channel.description)}</description>`,
		`<atom:link href="${e(channel.selfUrl)}" rel="self" type="application/rss+xml"/>`
	];
	for (const item of items) {
		lines.push(
			'<item>',
			`<title>${e(item.title)}</title>`,
			`<link>${e(item.url)}</link>`,
			`<guid isPermaLink="true">${e(item.url)}</guid>`
		);
		const pubDate = item.date ? toRfc822(item.date) : null;
		if (pubDate) lines.push(`<pubDate>${pubDate}</pubDate>`);
		const description = itemDescription(item);
		if (description) lines.push(`<description>${e(description)}</description>`);
		lines.push('</item>');
	}
	lines.push('</channel>', '</rss>', '');
	return lines.join('\n');
}

export function rssEtag(body: string): string {
	return `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
}
