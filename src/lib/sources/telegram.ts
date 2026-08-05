import type { Entry } from "$lib/types";
import type { SourceRules } from "./types";
import { hostOf } from "./host";
import { storageGet, storageSet } from "$lib/storage";
import { authedFetch } from "$lib/api";

// Telegram feeds (via RSS-Bridge) have a generic bridge-instance feed_url, but every post links to
// t.me — so the post URL host is the reliable "this is a Telegram post" signal.
function isTelegramPost(entry: Entry): boolean {
  return hostOf(entry.url) === "t.me";
}

// A Telegram post URL is https://t.me/{channel}/{id} (public) or https://t.me/s/{channel}/{id}
// (preview). The channel root page's og:image is the channel avatar. Returns the root URL, or null.
function channelRoot(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.host !== "t.me") return null;
    const seg = u.pathname.split("/").filter(Boolean);
    const channel = seg[0] === "s" ? seg[1] : seg[0];
    return channel ? `https://t.me/${channel}` : null;
  } catch {
    return null;
  }
}

// A Telegram text-only post's og:image is the channel avatar, so the same image repeats as a card
// cover across many posts. We recognise it two ways and drop it as a cover:
//   (a) prime() — the og:image of the channel root page (immediate, so fresh posts never flash);
//   (b) coverHidden() — any cover URL that repeats across >= REPEAT_THRESHOLD distinct posts.
// (b) is essential because Telegram rotates the telesco.pe file token over time: a months-old
// cached post cover points at a stale avatar URL that (a)'s freshly-resolved channel avatar no
// longer matches — but that stale URL still repeats across the feed's text posts, so (b) catches
// it. Both signals feed the same per-feed set of known avatar URLs, persisted to localStorage.
// (The sidebar icon already is the channel avatar — Miniflux fetches the t.me favicon — so, unlike
// github, there's nothing to repurpose for the icon.)
const KNOWN_KEY = "tgAvatars_v2"; // feedId -> known avatar url[]
const REPEAT_THRESHOLD = 3;

let knownCache: Record<string, string[]> | null = null;
const knownSets = new Map<number, Set<string>>();
const rootFetched = new Set<number>();
// feedId -> (cover url -> distinct post ids that used it) — repetition tally, in-memory only.
const tally = new Map<number, Map<string, Set<number>>>();

function knownStore(): Record<string, string[]> {
  if (knownCache === null)
    knownCache = storageGet<Record<string, string[]>>(KNOWN_KEY, {});
  return knownCache;
}

function knownFor(feedId: number): Set<string> {
  let set = knownSets.get(feedId);
  if (!set) {
    set = new Set(knownStore()[String(feedId)] ?? []);
    knownSets.set(feedId, set);
  }
  return set;
}

// Record `url` as a known avatar for the feed; returns true only when it was newly added, so the
// caller clears it from already-loaded posts exactly once.
function remember(feedId: number, url: string): boolean {
  const set = knownFor(feedId);
  if (set.has(url)) return false;
  set.add(url);
  const store = knownStore();
  store[String(feedId)] = [...set];
  storageSet(KNOWN_KEY, store);
  return true;
}

function tallyFor(feedId: number, url: string): Set<number> {
  let byUrl = tally.get(feedId);
  if (!byUrl) {
    byUrl = new Map();
    tally.set(feedId, byUrl);
  }
  let ids = byUrl.get(url);
  if (!ids) {
    ids = new Set();
    byUrl.set(url, ids);
  }
  return ids;
}

export const telegramSource: SourceRules = {
  id: "telegram",
  appliesTo: isTelegramPost,

  coverHidden(entry, url, ctx) {
    if (!url) return false;
    const feedId = entry.feed.id;
    if (knownFor(feedId).has(url)) return true;
    // Not yet known — does this cover repeat across posts? (The avatar does; real photos don't.)
    const ids = tallyFor(feedId, url);
    ids.add(entry.id);
    if (ids.size >= REPEAT_THRESHOLD && remember(feedId, url)) {
      ctx.clearCover(feedId, url); // retro-hide posts already showing it
      return true;
    }
    return false;
  },

  // Resolve the channel root's og:image (the avatar) once per feed so fresh posts are suppressed
  // immediately, without waiting for the repetition tally. Only the channel root is fetched here;
  // each post's own og:image is resolved by the pipeline's ensureThumbnail.
  prime(entry, ctx) {
    const feedId = entry.feed.id;
    if (rootFetched.has(feedId)) return;
    const root = channelRoot(entry.url);
    if (!root) return;
    rootFetched.add(feedId);
    ctx.schedule(async () => {
      let avatar = "";
      try {
        const res = await authedFetch(`/api/og-image?url=${encodeURIComponent(root)}`);
        if (res.ok) avatar = (await res.json())?.url || "";
      } catch {
        rootFetched.delete(feedId); // transient — allow a later retry
        return;
      }
      if (avatar && remember(feedId, avatar)) ctx.clearCover(feedId, avatar);
    });
  },
};
