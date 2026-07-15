import type { Entry } from "$lib/types";
import type { SourceRules } from "./types";
import { hostOf } from "./host";

// GitHub release feeds ship the author avatar as a media:thumbnail — an image enclosure at
// avatars.githubusercontent.com. It's uninformative as a card/cover image, so github feeds are
// treated as imageless; the avatar is repurposed as the feed's sidebar icon instead so multiple
// github feeds stay visually distinct (the icon override persists via the favicons cache).
function githubAvatar(entry: Entry): string | null {
  const enc = entry.enclosures?.find(
    (e) =>
      e.url &&
      e.mime_type?.startsWith("image/") &&
      /(^|\.)avatars\.githubusercontent\.com$/.test(hostOf(e.url)),
  );
  return enc?.url ?? null;
}

export const githubSource: SourceRules = {
  id: "github",
  appliesTo(entry) {
    const h = hostOf(entry.feed.feed_url);
    return h === "github.com" || h === "www.github.com";
  },
  // Never a useful card/cover image — show none, and skip the og:image fallback too.
  imageless() {
    return true;
  },
  feedIcon(entry) {
    return githubAvatar(entry);
  },
};
