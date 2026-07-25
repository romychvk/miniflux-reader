import { apiCall } from '$lib/api';

// Feed discovery for the Add Feed form.
//
// The engine is Miniflux's own POST /v1/discover: it already checks whether the URL is itself
// a feed, reads <link type="application/rss+xml|atom+xml|feed+json"> tags, knows YouTube, and
// probes well-known paths (feed/, rss.xml, atom.xml…). It runs on the Miniflux side, so there
// is no page to fetch here and no CORS to work around.
//
// Miniflux 2.3.3 added a GitHub rule of its own, emitting the same URLs and titles githubFeeds()
// does for github.com/<user> and github.com/<owner>/<repo> (findFeeds dedupes the overlap). Ours
// stays for the two cases upstream doesn't handle: deeper paths like /owner/repo/releases, which
// it returns nothing for, and site sections like /topics/rss, which it mistakes for a repository —
// see isGithubSection() below.

export type FoundFeed = {
	title: string;
	url: string;
	type?: string;
};

// Paths under github.com that are site sections rather than a user or organization.
const GITHUB_RESERVED = new Set([
	'about', 'apps', 'codespaces', 'collections', 'events', 'explore', 'features', 'issues',
	'join', 'login', 'marketplace', 'new', 'notifications', 'orgs', 'pricing', 'pulls',
	'search', 'settings', 'sponsors', 'topics', 'trending'
]);

const FEED_SUFFIX = /\.(atom|rss|xml)$/i;

function parseGithubUrl(url: string): URL | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null;
	return parsed;
}

// A github.com page whose first path segment is a site section rather than an owner. Miniflux
// reads /topics/rss as owner "topics" + repo "rss" and answers with three .atom URLs that 404 —
// and because those now arrive from the server, GITHUB_RESERVED can only keep them out of the
// picker by filtering the discovered list (see findFeeds).
function isGithubSection(pageUrl: string): boolean {
	const parsed = parseGithubUrl(pageUrl);
	if (!parsed) return false;
	const first = parsed.pathname.split('/').filter(Boolean)[0];
	return !!first && GITHUB_RESERVED.has(first.toLowerCase());
}

// One of the three repository feeds guessed from a URL's shape, as opposed to a feed the page
// itself advertises.
function isGithubRepoGuess(feedUrl: string): boolean {
	const parsed = parseGithubUrl(feedUrl);
	return !!parsed && /\/(commits|releases|tags)\.atom$/.test(parsed.pathname);
}

// GitHub exposes Atom feeds that are never advertised in the page's <link> tags, so they can
// only be found by knowing the URL shape.
export function githubFeeds(pageUrl: string): FoundFeed[] {
	const parsed = parseGithubUrl(pageUrl);
	if (!parsed) return [];

	// The URL already is a feed: adding siblings would turn a one-click add into a picker.
	if (FEED_SUFFIX.test(parsed.pathname)) return [];

	const segments = parsed.pathname.split('/').filter(Boolean);
	if (segments.length === 0 || GITHUB_RESERVED.has(segments[0].toLowerCase())) return [];

	if (segments.length === 1) {
		return [{ title: segments[0], url: `https://github.com/${segments[0]}.atom`, type: 'atom' }];
	}

	// Anything below <owner>/<repo> (e.g. /owner/repo/releases) still describes that repo.
	const repo = `https://github.com/${segments[0]}/${segments[1]}/`;
	return [
		{ title: 'Commits', url: `${repo}commits.atom`, type: 'atom' },
		{ title: 'Releases', url: `${repo}releases.atom`, type: 'atom' },
		{ title: 'Tags', url: `${repo}tags.atom`, type: 'atom' }
	];
}

function normalizeUrl(url: string): string {
	try {
		const u = new URL(url);
		return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
	} catch {
		return url.trim();
	}
}

// Returns every feed we can find for a page URL — empty when there is none to find.
export async function findFeeds(pageUrl: string): Promise<FoundFeed[]> {
	let discovered: FoundFeed[] = [];
	try {
		const res = await apiCall<FoundFeed[]>('discover', {
			method: 'POST',
			body: JSON.stringify({ url: pageUrl })
		});
		if (Array.isArray(res)) discovered = res;
	} catch {
		// Miniflux answers 404 when it finds nothing and 500 when it cannot fetch the page.
		// Both mean the same thing here, and the caller says so inline next to the RSS-Bridge
		// offer — so this stays quiet instead of raising a ui.showError() toast.
	}

	// On a site section every repository feed guessed for the page is fictional. githubFeeds()
	// never generates those; Miniflux's have to be dropped so the picker stays honest.
	if (isGithubSection(pageUrl)) {
		discovered = discovered.filter((f) => !isGithubRepoGuess(f.url));
	}

	const merged = [...discovered];
	const seen = new Set(discovered.map((f) => normalizeUrl(f.url)));

	// Discovered entries win a collision: their titles come from the site itself
	// ("mattermost Release Notes"), ours are generic ("Releases").
	for (const feed of githubFeeds(pageUrl)) {
		const key = normalizeUrl(feed.url);
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(feed);
	}

	return merged;
}
