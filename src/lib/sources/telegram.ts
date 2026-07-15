import type { Entry } from "$lib/types";
import type { SourceRules } from "./types";
import { hostOf } from "./host";
import { storageGet, storageSet } from "$lib/storage";

// Telegram feeds (via RSS-Bridge) have a generic rssbridge.de feed_url, but every post links to
// t.me — so the post URL host is the reliable "this is a Telegram post" signal.
function isTelegramPost(entry: Entry): boolean {
  return hostOf(entry.url) === "t.me";
}

// A Telegram post URL is https://t.me/{channel}/{id} (public) or https://t.me/s/{channel}/{id}
// (preview). The channel root page's og:image is the channel avatar — the very same image
// Telegram serves as the og:image of every *text-only* post, so it otherwise shows as an
// identical card cover on every such post. Returns the channel root URL, or null.
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

// Per-feed channel avatar (the og:image of the channel root), resolved once and cached in
// localStorage. '' means "checked, channel has no avatar".
const AVATAR_KEY = "tgAvatars_v1"; // feedId -> avatar url
let avatarCache: Record<string, string> | null = null;
const inFlight = new Set<number>();

function avatars(): Record<string, string> {
  if (avatarCache === null)
    avatarCache = storageGet<Record<string, string>>(AVATAR_KEY, {});
  return avatarCache;
}

export const telegramSource: SourceRules = {
  id: "telegram",
  appliesTo: isTelegramPost,

  // A post's og:image equal to the resolved channel avatar means it's a text-only post — drop it
  // so it doesn't show the repeated avatar as a card cover. Posts with a real photo have a
  // different og:image and keep it. The sidebar icon already is the channel avatar (Miniflux
  // fetches the t.me favicon), so — unlike github — there's nothing to repurpose for the icon.
  coverHidden(entry, url) {
    return !!url && avatars()[String(entry.feed.id)] === url;
  },

  // Resolve (once per feed) the channel avatar so coverHidden() can recognise it. Only the channel
  // root is fetched here; each post's own og:image is resolved by the pipeline's ensureThumbnail.
  prime(entry, ctx) {
    const feedId = entry.feed.id;
    const cache = avatars();
    if (cache[String(feedId)] !== undefined || inFlight.has(feedId)) return;
    const root = channelRoot(entry.url);
    if (!root) return;
    inFlight.add(feedId);
    ctx.schedule(async () => {
      let avatar: string | null = null;
      try {
        const res = await fetch(`/api/og-image?url=${encodeURIComponent(root)}`);
        if (res.ok) avatar = (await res.json())?.url || "";
      } catch {
        /* transient — leave unresolved so a later load retries */
      } finally {
        inFlight.delete(feedId);
      }
      if (avatar === null) return; // undetermined — don't cache a transient failure
      cache[String(feedId)] = avatar;
      storageSet(AVATAR_KEY, cache);
      // A post can resolve its own og:image (the avatar) before this channel-root lookup returns;
      // drop it from any such already-loaded post now that we know it's the channel avatar.
      if (avatar) ctx.clearCover(feedId, avatar);
    });
  },
};
