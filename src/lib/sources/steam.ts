import type { SourceRules } from "./types";
import { hostOf } from "./host";

// A Steam group's announcement page carries no image of its own: the RSS body is plain text plus
// links (no <img>, no enclosures), and the page's og:image is always the group's avatar. So the
// only cover the pipeline can resolve is that avatar, repeated identically on every card — drop it.
// Steam serves avatars from a dedicated host, so one host check identifies one; no content image
// can be confused with it, and there's no need for telegram's repetition heuristic. (Announcements
// *can* embed images via bbcode, so github's blanket `imageless` would be too coarse here.)
// The avatar is repurposed as the feed's sidebar icon, like github: Miniflux fetches the
// steamcommunity.com favicon, which is the generic Steam logo — identical for every Steam feed.
function isSteamAvatar(url: string): boolean {
  // avatars.fastly.steamstatic.com, avatars.akamai.steamstatic.com, avatars.steamstatic.com, ...
  const h = hostOf(url);
  return h.startsWith("avatars.") && h.endsWith(".steamstatic.com");
}

export const steamSource: SourceRules = {
  id: "steam",
  appliesTo(entry) {
    const h = hostOf(entry.feed.feed_url);
    return h === "steamcommunity.com" || h === "www.steamcommunity.com";
  },
  coverHidden(entry, url, ctx) {
    if (!isSteamAvatar(url)) return false;
    // Useless as a card cover, but it's exactly what the sidebar icon should be.
    ctx.setFeedIcon(entry.feed.id, url);
    return true;
  },
};
