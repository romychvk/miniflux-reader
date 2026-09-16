import type { Entry } from "$lib/types";
import type { SourceRules } from "./types";
import { hostOf } from "./host";
import { rememberDefaultCover } from "$lib/defaultCover";
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

// A Telegram text-only post's og:image is the channel avatar, so the same image would repeat as a
// card cover across every text post. The pipeline's shared detector ($lib/defaultCover) catches
// that on its own, from the repetition — including the case this module cannot see, a months-old
// cached post whose cover points at a stale telesco.pe file token that the current avatar URL no
// longer matches. All this source adds is the immediate signal: the channel root's og:image *is*
// the avatar, so resolving it once per feed suppresses fresh posts without waiting for a third one
// to arrive. (The sidebar icon already is the channel avatar — Miniflux fetches the t.me favicon —
// so, unlike github, there's nothing to repurpose for the icon.)
const rootFetched = new Set<number>();

export const telegramSource: SourceRules = {
  id: "telegram",
  appliesTo: isTelegramPost,

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
      if (avatar && rememberDefaultCover(feedId, avatar)) ctx.clearCover(feedId, avatar);
    });
  },
};
