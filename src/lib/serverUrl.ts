// Reduce a user-entered Miniflux URL to its origin (scheme://host[:port]). Drops any path
// (e.g. a pasted `/v1/` API base), query, hash, trailing slashes and surrounding whitespace,
// and assumes https when no scheme is given. Throws on an unparseable value. The proxy always
// roots calls at `/v1/…` on this origin and ALLOWED_MINIFLUX_SERVER is matched exactly, so a
// stray path is only ever what breaks the pin — never something the app needs.
export function normalizeServerUrl(input: string): string {
	let s = input.trim();
	if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
	return new URL(s).origin;
}
