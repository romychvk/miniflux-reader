import { apiCall } from '$lib/api';

// Feed discovery for the Add Feed form.
//
// The engine is Miniflux's own POST /v1/discover: it already checks whether the URL is itself
// a feed, reads <link type="application/rss+xml|atom+xml|feed+json"> tags, knows YouTube, and
// probes well-known paths (feed/, rss.xml, atom.xml…). It runs on the Miniflux side, so there
// is no page to fetch here and no CORS to work around.
//
// Its one blind spot is GitHub — the upstream rule landed after 2.3.2, so no released Miniflux
// has it — which githubFeeds() fills in below.

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

// GitHub exposes Atom feeds that are never advertised in the page's <link> tags, so they can
// only be found by knowing the URL shape.
export function githubFeeds(pageUrl: string): FoundFeed[] {
	let parsed: URL;
	try {
		parsed = new URL(pageUrl);
	} catch {
		return [];
	}

	if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return [];

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
