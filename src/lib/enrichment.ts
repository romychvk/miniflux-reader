import type { Entry } from "$lib/types";
import { sourceFor } from "$lib/sources";
import {
  asCoverRule,
  hasCoverRule,
  COVER_STORAGE_PREFIX,
  type CoverRule,
} from "$lib/cover";
import { storageGet } from "$lib/storage";
import { collectImageUrls, loadArchiveEnabled } from "$lib/imageArchive";

// Entry enrichment: derives everything a card needs from an entry's raw content — the thumbnail,
// the text preview, and (for scraped CssSelectorBridge feeds) the real publication date — in a
// single DOM parse per entry. Extracted from the entries store; these are pure helpers with no
// reactive state, driven by enrichEntries (initial load) and the re-fetch path.

export function decodeContent(html: string): string {
  const trimmed = html.trim();
  if (
    trimmed.startsWith("&lt;") ||
    (!trimmed.startsWith("<") && trimmed.includes("&lt;"))
  ) {
    const ta = document.createElement("textarea");
    ta.innerHTML = html;
    return ta.value;
  }
  return html;
}

const domParser = new DOMParser();

// Parse (decoded) article HTML into a Document. Exposed so the re-fetch path shares the same
// single-parse pass the enrichEntries loop uses internally.
export function parseContent(html: string): Document {
  return domParser.parseFromString(html, "text/html");
}

function isPlaceholderUrl(url: string): boolean {
  if (!url) return true;
  if (url.startsWith("data:")) return true; // inline svg/gif placeholders
  return /(?:^|[/_-])(?:1x1|pixel|spacer|blank|placeholder|loader|loading|tracking)(?:[._-]|$)/i.test(
    url,
  );
}

// The card thumbnail is the first "real" image in the content. Modern sites lazy-load
// images (real URL in data-src/srcset, a placeholder in src), so check those too and
// skip tracking pixels / tiny spacers — otherwise the card looks image-less.
function extractThumbnail(doc: Document): string | null {
  for (const img of doc.querySelectorAll("img")) {
    const w = parseInt(img.getAttribute("width") || "", 10);
    const h = parseInt(img.getAttribute("height") || "", 10);
    if ((w && w <= 2) || (h && h <= 2)) continue; // tracking pixel

    const srcset =
      img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    const firstFromSrcset = srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";

    for (const candidate of [
      img.getAttribute("src") || "",
      img.getAttribute("data-src") || "",
      img.getAttribute("data-original") || "",
      img.getAttribute("data-lazy-src") || "",
      firstFromSrcset,
    ]) {
      if (candidate && !isPlaceholderUrl(candidate)) return candidate;
    }
  }
  return null;
}

// Mutates `doc` (inserts spacing text nodes before block elements), so callers must run any
// read-only extraction (thumbnail, date) against the shared Document *before* this.
export function extractDescription(doc: Document): string {
  for (const br of doc.querySelectorAll(
    "br, p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote",
  )) {
    br.before(" ");
  }
  const text = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 150 ? text.slice(0, 250) + "..." : text;
}

// CssSelectorBridge does not expose a publication-date selector. When it emits an item
// without a timestamp, Miniflux falls back to the time it discovered the item, making a
// freshly-added scraped feed look as though every article was published at once. Expanded
// article HTML commonly retains the real machine-readable date as <time datetime="…">.
// Use that value for scraped feeds only; ordinary RSS/Atom timestamps remain authoritative.
function isCssSelectorFeed(entry: Entry): boolean {
  try {
    return (
      new URL(entry.feed.feed_url).searchParams.get("bridge") ===
      "CssSelectorBridge"
    );
  } catch {
    return false;
  }
}

function publishedAtFromContent(entry: Entry, doc: Document): string | null {
  if (!isCssSelectorFeed(entry)) return null;

  const raw = doc.querySelector("time[datetime]")?.getAttribute("datetime")?.trim();
  if (!raw) return null;

  const timestamp = Date.parse(raw);
  // Reject malformed values and implausible/event dates. A small future allowance covers
  // clock skew between the source, RSS-Bridge, Miniflux and the browser.
  const earliest = Date.UTC(1990, 0, 1);
  const latest = Date.now() + 24 * 60 * 60 * 1000;
  if (!Number.isFinite(timestamp) || timestamp < earliest || timestamp > latest) return null;

  return new Date(timestamp).toISOString();
}

// An image attached to the RSS item itself (enclosure / media:content / media:thumbnail —
// Miniflux maps all of these to `enclosures`). A free thumbnail source when the content
// has no usable <img>.
function imageEnclosure(entry: Entry): string | null {
  const enc = entry.enclosures?.find(
    (e) => e.url && e.mime_type?.startsWith("image/"),
  );
  return enc?.url ?? null;
}

// Best thumbnail without any extra network request: first real content image, else the
// RSS image enclosure. When the feed has a custom cover rule we skip this entirely and let
// ensureThumbnail() resolve the cover from the source page (the rule is authoritative for
// such feeds — typically scraped forums whose content holds only UI chrome). The og:image
// fallback (a network call) is handled lazily by ensureThumbnail() when this returns null.
export function pickThumbnail(
  entry: Entry,
  doc: Document | null,
  hasCustomRule: boolean,
): string | null {
  // Some sources never carry a useful card/cover image (e.g. github release feeds hold only the
  // author avatar) — show none, and skip the og:image fallback too (see ensureThumbnail).
  if (sourceFor(entry)?.imageless?.(entry)) return null;
  if (hasCustomRule) return null;
  return (doc ? extractThumbnail(doc) : null) ?? imageEnclosure(entry);
}

export function enrichEntries(
  entries: Entry[],
  coverRuleFor: (feedId: number) => CoverRule,
  archiveFor: (feedId: number) => boolean = loadArchiveEnabled,
): Entry[] {
  // One localStorage read per feed, not per entry — a page holds up to 100 entries drawn from a
  // handful of feeds.
  const archiveCache = new Map<number, boolean>();
  const archived = (feedId: number): boolean => {
    let on = archiveCache.get(feedId);
    if (on === undefined) archiveCache.set(feedId, (on = archiveFor(feedId)));
    return on;
  };

  for (const entry of entries) {
    if (entry.content) entry.content = decodeContent(entry.content);
    // Parse the (decoded) content ONCE and share the Document across all three DOM readers.
    // Previously each of thumbnail / description / date extraction parsed independently
    // (2–3 DOMParser passes per entry, ~200–300 on a 100-entry page); now it's one per entry.
    const doc = entry.content
      ? domParser.parseFromString(entry.content, "text/html")
      : null;

    // Read-only extractions first; extractDescription mutates the shared doc, so it runs last.
    const contentPublishedAt = doc ? publishedAtFromContent(entry, doc) : null;
    if (contentPublishedAt) entry.published_at = contentPublishedAt;
    entry._thumbnailUrl = pickThumbnail(
      entry,
      doc,
      hasCoverRule(coverRuleFor(entry.feed.id)),
    );
    // Collect the source image URLs before extractDescription runs — it mutates the shared doc,
    // and images are among the things it strips out on its way to a text summary.
    entry._archiveImages = archived(entry.feed.id);
    if (entry._archiveImages)
      entry._imageUrls = collectImageUrls(doc, entry._thumbnailUrl);

    entry._description = doc ? extractDescription(doc) : "";
  }
  return entries;
}

// A feed's cover-extraction rule (CSS selector + attr), or an empty rule when unset.
export function loadCoverRule(feedId: number): CoverRule {
  return asCoverRule(storageGet<unknown>(COVER_STORAGE_PREFIX + feedId, null));
}
