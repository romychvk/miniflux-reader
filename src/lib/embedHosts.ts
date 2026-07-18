// Registrable domains whose <iframe> embeds the reader legitimately renders (the video/audio
// players styled in EntryContent). Every other iframe — arbitrary ones from feed or AI-generated
// content — is dropped by the sanitizer. Kept dependency-free so it stays pure and unit-testable.
export const EMBED_HOSTS = [
	'youtube.com',
	'youtube-nocookie.com',
	'youtu.be',
	'vimeo.com',
	'dailymotion.com',
	'dai.ly',
	'bilibili.com',
	'bandcamp.com',
	'soundcloud.com',
	'spotify.com'
];

// Fails closed: only an absolute http(s) URL on an allow-listed host (exact or subdomain) passes;
// relative srcs, odd schemes and unparseable values are rejected.
export function isAllowedEmbed(src: string): boolean {
	let u: URL;
	try {
		u = new URL(src);
	} catch {
		return false;
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
	const host = u.hostname.toLowerCase();
	return EMBED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}
