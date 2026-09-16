import { storageGet, storageRemove, storageSet } from '$lib/storage';

// A cover the pipeline resolves from the article's own page — the page's og:image, or a feed's
// cover-rule match — can turn out to be the site's default picture rather than anything to do with
// this article: a WordPress theme's fallback og:image (archaeology.org hands out
// ArchaeologyDefaultImage@2x.jpg for every news item that carries no photo of its own), a Telegram
// channel's avatar, a forum's logo. It is better than nothing exactly once; repeated down a grid of
// cards it reads as duplicated content — the feed icon and name under every card already say where
// the card came from — and it takes the room the card could have spent on the article's text.
//
// Repetition is the signal, and it needs no per-site knowledge: a real cover belongs to one
// article, a default belongs to the feed. Once the same URL has been adopted by REPEAT_THRESHOLD
// distinct entries of one feed it is that feed's default — hidden from then on, retroactively from
// the cards already showing it, and remembered per feed (localStorage) so later sessions hide it on
// the first card instead of relearning.
//
// Only *resolved* covers come through here. A content <img> or an image enclosure is the item's own
// markup, and a feed that repeats one there — a column's standing banner, an album's art on every
// track — means it.

const KNOWN_KEY = 'defaultCovers_v1'; // feedId -> known default cover url[]
const LEGACY_KEY = 'tgAvatars_v2'; // this store's telegram-only predecessor
const REPEAT_THRESHOLD = 3;
// A source that rotates its URLs (Telegram re-mints the telesco.pe file token) mints a new default
// every so often, and the old ones are still worth knowing — a months-old cached cover points at
// one. Bounded so the list can't grow forever.
const MAX_PER_FEED = 16;

let knownCache: Record<string, string[]> | null = null;
const knownSets = new Map<number, Set<string>>();
// feedId -> (cover url -> distinct entry ids that adopted it) — the tally, in-memory only.
const tally = new Map<number, Map<string, Set<number>>>();

function knownStore(): Record<string, string[]> {
	if (knownCache === null) {
		knownCache = storageGet<Record<string, string[]>>(KNOWN_KEY, {});
		// The telegram source learned channel avatars under its own key before the detector was
		// shared. Carry them over once, so a rotated avatar URL it already knows about — which its
		// own freshly-resolved one no longer matches — doesn't have to be relearned.
		const legacy = storageGet<Record<string, string[]>>(LEGACY_KEY, {});
		if (Object.keys(legacy).length > 0) {
			for (const [feedId, urls] of Object.entries(legacy)) {
				const merged = new Set([...(knownCache[feedId] ?? []), ...urls]);
				knownCache[feedId] = [...merged].slice(-MAX_PER_FEED);
			}
			storageSet(KNOWN_KEY, knownCache);
			storageRemove(LEGACY_KEY);
		}
	}
	return knownCache;
}

function knownFor(feedId: number): Set<string> {
	let set = knownSets.get(feedId);
	if (!set) knownSets.set(feedId, (set = new Set(knownStore()[String(feedId)] ?? [])));
	return set;
}

function tallyFor(feedId: number, url: string): Set<number> {
	let byUrl = tally.get(feedId);
	if (!byUrl) tally.set(feedId, (byUrl = new Map()));
	let ids = byUrl.get(url);
	if (!ids) byUrl.set(url, (ids = new Set()));
	return ids;
}

// Record `url` as a known default cover of the feed, whatever the tally says — for a source that
// can recognise its own default outright (see $lib/sources/telegram). True only when the URL was
// newly added, so the caller sweeps the cards already showing it exactly once.
export function rememberDefaultCover(feedId: number, url: string): boolean {
	if (!url) return false;
	const set = knownFor(feedId);
	if (set.has(url)) return false;
	set.add(url);
	// Insertion order is oldest first, so the trim drops what a rotating source stopped serving longest ago.
	const kept = [...set].slice(-MAX_PER_FEED);
	if (kept.length < set.size) knownSets.set(feedId, new Set(kept));
	const store = knownStore();
	store[String(feedId)] = kept;
	storageSet(KNOWN_KEY, store);
	return true;
}

// Is `url` the feed's default cover rather than this entry's own picture? Counts the use, so call
// it once per (entry, url) pair, at the point the cover would be shown. `onLearn` runs only on the
// call that crosses the threshold — the one call that has to sweep the cards already showing it.
export function isDefaultCover(
	feedId: number,
	entryId: number,
	url: string,
	onLearn?: (url: string) => void
): boolean {
	if (!url) return false;
	if (knownFor(feedId).has(url)) return true;
	const ids = tallyFor(feedId, url);
	ids.add(entryId);
	if (ids.size < REPEAT_THRESHOLD) return false;
	if (rememberDefaultCover(feedId, url)) onLearn?.(url);
	return true;
}

export { REPEAT_THRESHOLD, MAX_PER_FEED };
