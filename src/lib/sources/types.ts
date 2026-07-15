import type { Entry } from "$lib/types";

// A per-source (per-host) rule set for the card/cover image pipeline. Each source is matched by
// the entry's host and implements only the hooks it needs; the thumbnail pipeline in
// entries.svelte.ts consults the registry (sourceFor) at a few fixed points. Adding a source is
// one new module + one array entry in ./index — no change to the pipeline itself.
export interface SourceRules {
  // Stable identifier, for debugging/logging.
  id: string;

  // Does this source apply to the given entry? (Typically a host check on entry.url / feed_url.)
  appliesTo(entry: Entry): boolean;

  // The source never has a usable card/cover image — skip the content <img>, the enclosure AND
  // the lazy og:image/cover fetch entirely (e.g. github release feeds carry only the author
  // avatar). Consulted in both pickThumbnail() and ensureThumbnail().
  imageless?(entry: Entry): boolean;

  // Derive the feed's sidebar icon from an entry, or null (e.g. the github author avatar).
  // Consulted once per feed on load; the newest matching entry wins.
  feedIcon?(entry: Entry): string | null;

  // Kick off any async work needed before coverHidden() can answer — idempotent, safe to call
  // per row (e.g. resolve a telegram channel's avatar once and cache it). Uses ctx to schedule
  // bounded-concurrency work and to react when the answer arrives.
  prime?(entry: Entry, ctx: SourceContext): void;

  // Given a resolved cover URL for this entry, return true to drop it (don't show it as a card
  // image) — e.g. a telegram text post whose og:image is the repeated channel avatar.
  coverHidden?(entry: Entry, url: string): boolean;
}

// Capabilities the pipeline lends to a source's prime() — it owns the og scheduler, the feed-icon
// setter and the loaded entry list, none of which a standalone module can reach.
export interface SourceContext {
  // Run a task under the shared bounded-concurrency og scheduler.
  schedule(task: () => Promise<void>): void;
  // Override a feed's sidebar icon (persisted to the favicons cache).
  setFeedIcon(feedId: number, url: string): void;
  // Retroactively drop `url` from any already-loaded entry of `feedId` that adopted it as its
  // cover before the source knew to suppress it.
  clearCover(feedId: number, url: string): void;
}
