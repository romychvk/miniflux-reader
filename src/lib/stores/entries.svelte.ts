import { apiCall, authedFetch } from "$lib/api";
import type { Entry } from "$lib/types";
import type { FilterRule } from "$lib/contentFilter";
import { storageGet, storageGetString, storageSet } from "$lib/storage";
import {
  dedupeEntries,
  asDedupMode,
  DEDUP_STORAGE_PREFIX,
  type DedupMode,
} from "$lib/dedup";
import { hasCoverRule, extractCover } from "$lib/cover";
import { requestArchive } from "$lib/imageArchiveClient";
import { collectImageUrls } from "$lib/imageArchive";
import {
  decodeContent,
  parseContent,
  extractDescription,
  pickThumbnail,
  enrichEntries,
  loadCoverRule,
} from "$lib/enrichment";
import {
  loadFilterAction,
  loadHideRules,
  compileMatchers,
  isEntryHidden,
  type HideMatchers,
} from "$lib/filterHide";
import { sourceFor, type SourceContext } from "$lib/sources";
import { mapPool } from "$lib/pool";
import { feeds } from "./feeds.svelte";
import { ui } from "./ui.svelte";

export interface RefetchError {
  id: number;
  title: string;
  url: string;
  message: string;
}

// The feed id for a single-feed entries path (`feeds/{id}/entries`), or null for aggregate
// views ("entries" for All, `categories/{id}/entries` for a category).
function feedIdFromEntriesPath(apiPath: string): number | null {
  const m = apiPath.match(/^feeds\/(\d+)\/entries/);
  return m ? Number(m[1]) : null;
}

// --- Lazy cover resolution (og:image by default, per-feed rule when set) --------------
// Lazy, cached, bounded-concurrency. Bump the cache key on any extraction change so stale
// results re-check once.
// v2: added forum (rutracker) post-cover extraction (was negative-cached before).
// v3: skip rutracker's own UI assets (e.g. the "ответить" reply placeholder).
// v4: transient failures are no longer cached as '' — drop entries poisoned by that bug.
// v5: rutracker handling moved to a per-feed cover rule; covers now come from og:image
//     (default) or the feed's CSS rule. Drop values produced by the old hardcoded path.
const OG_CACHE_KEY = "ogImages_v5";
const SHOW_ALL_KEY = "showAll";
const OG_MAX_CONCURRENT = 4;
let ogCache: Record<string, string> | null = null; // url -> image url ('' = checked, none)
const ogInFlight = new Set<string>();
let ogActive = 0;
const ogQueue: (() => void)[] = [];

function ogSchedule(task: () => Promise<void>): void {
  const run = () => {
    ogActive++;
    task().finally(() => {
      ogActive--;
      ogQueue.shift()?.();
    });
  };
  if (ogActive < OG_MAX_CONCURRENT) run();
  else ogQueue.push(run);
}

// The OG cache is a regenerable localStorage cache (not synced — see isSyncableKey). Resolving a
// page of covers used to JSON.stringify and write the WHOLE cache after every single image; at
// concurrency 4 that's a burst of full serializations. Coalesce them: mark the cache dirty and
// flush at most once per window, plus an immediate flush when the tab is hidden/closed so a
// just-resolved cover survives a navigation. A hard kill can lose the last batch, but the cache
// is regenerable — the affected covers simply re-resolve (and re-cache) next session.
const OG_WRITE_DELAY_MS = 500;
let ogWriteTimer: ReturnType<typeof setTimeout> | null = null;
let ogDirty = false;
let ogUnloadHooked = false;

function flushOgCache(): void {
  if (ogWriteTimer !== null) {
    clearTimeout(ogWriteTimer);
    ogWriteTimer = null;
  }
  if (ogDirty && ogCache) {
    storageSet(OG_CACHE_KEY, ogCache);
    ogDirty = false;
  }
}

function scheduleOgCacheFlush(): void {
  ogDirty = true;
  if (!ogUnloadHooked && typeof window !== "undefined") {
    // Flush a pending batch on tab hide/close (the mobile-safe pair) so covers aren't lost.
    window.addEventListener("pagehide", flushOgCache);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushOgCache();
    });
    ogUnloadHooked = true;
  }
  // Trailing throttle: at most one write per window no matter how many covers resolve in it.
  if (ogWriteTimer === null) ogWriteTimer = setTimeout(flushOgCache, OG_WRITE_DELAY_MS);
}

function createEntriesStore() {
  let entries = $state<Entry[]>([]);
  let loading = $state(false);
  let showAll = $state(false);
  let searchQuery = $state("");
  let abortController: AbortController | null = null;
  let cachedUserId: number | null = null;

  // The current Miniflux user id (needed for the All-view mark-all-as-read endpoint).
  // Fetched once and cached for the session.
  async function currentUserId(): Promise<number> {
    if (cachedUserId === null) {
      const me = await apiCall<{ id: number }>("me");
      cachedUserId = me.id;
    }
    return cachedUserId;
  }

  async function loadEntries(apiPath: string) {
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    loading = true;
    try {
      // The Bookmarks view lists starred entries regardless of read state, so
      // the unread-only default (and per-feed hide rules) must not apply here.
      const isStarredView = apiPath.includes("starred=true");
      const sep = apiPath.includes("?") ? "&" : "?";
      let params = "";
      if (searchQuery) {
        params = `search=${encodeURIComponent(searchQuery)}&`;
      } else if (!showAll && !isStarredView) {
        params = "status=unread&";
      }
      const data = await apiCall<{ total: number; entries: Entry[] }>(
        `${apiPath}${sep}${params}order=published_at&direction=desc&limit=100`,
        { signal },
      );

      // Let sources derive a feed's sidebar icon from an entry (e.g. github repurposes the
      // release-author avatar so multiple github feeds stay distinct). Newest entry per feed wins
      // (results are published_at desc). Works from any view (single feed or All/aggregate).
      const iconUpdates = new Map<number, string>();
      for (const e of data.entries ?? []) {
        if (iconUpdates.has(e.feed.id)) continue;
        const icon = sourceFor(e)?.feedIcon?.(e);
        if (icon) iconUpdates.set(e.feed.id, icon);
      }
      for (const [feedId, url] of iconUpdates) feeds.setFeedIcon(feedId, url);

      // Collapse source-level duplicates per each entry's feed setting (read fresh, memoized).
      const modeCache = new Map<number, DedupMode>();
      const modeFor = (id: number): DedupMode => {
        let m = modeCache.get(id);
        if (m === undefined) {
          m = asDedupMode(storageGetString(DEDUP_STORAGE_PREFIX + id, "off"));
          modeCache.set(id, m);
        }
        return m;
      };
      const deduped = dedupeEntries(
        enrichEntries(data.entries || [], loadCoverRule),
        modeFor,
      );
      // Miniflux sorted by its fallback discovery timestamp. Content-derived dates above can
      // differ, so restore the requested newest-first order before filters/navigation use it.
      deduped.sort(
        (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at),
      );

      // Hand the archived feeds' images to the server while the source still serves them. Runs
      // after dedupe so a collapsed duplicate isn't downloaded, and is fire-and-forget — nothing
      // in this load waits on it.
      const toArchive = deduped.flatMap((e) => e._imageUrls ?? []);
      if (toArchive.length > 0) requestArchive(toArchive);

      // For a single feed set to "hide (mark read)", reconcile the *whole* unread backlog so the
      // rules apply even when they were imported (Backup & Restore) or the backlog is larger than
      // one page — this runs on every load of the feed (page refresh, selection, Refresh Feed).
      // Hide matches from the view instantly; mark them read + fix counters in the background.
      // (This replaces applyClientHide for that feed so counters aren't decremented twice.)
      const singleFeedId = feedIdFromEntriesPath(apiPath);
      if (singleFeedId !== null && loadFilterAction(singleFeedId) === "mark-read") {
        const rules = loadHideRules(singleFeedId);
        const matchers = compileMatchers(rules);
        entries = showAll
          ? deduped
          : deduped.filter((e) => !isEntryHidden(e, matchers));
        void applyHideToExisting(singleFeedId, rules).catch(() => {
          // Best-effort background reconcile; failures leave the backlog for the next load.
        });
      } else {
        entries = isStarredView ? deduped : applyClientHide(deduped);
      }

      // Eagerly resolve covers for the newest rule-based entries so setting/changing a
      // feed's cover rule backfills the latest ~25 without needing to scroll each into view.
      // (Bounded concurrency + cache make repeat loads cheap; non-rule feeds stay lazy.)
      for (const e of entries.slice(0, 25)) {
        if (!e._thumbnailUrl && hasCoverRule(loadCoverRule(e.feed.id)))
          ensureThumbnail(e);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      ui.showError(e instanceof Error ? e.message : "Failed to load entries");
      entries = [];
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  // For feeds set to "hide (mark read)", mirror Miniflux's block/keep semantics on the client:
  // mark matching unread entries read (so they leave the unread view and the counters stay in
  // sync) and drop them from the current list. Only runs in the unread view — "show all" stays a
  // full, recoverable view. Marking is fired in the background; the list is filtered immediately.
  function applyClientHide(list: Entry[]): Entry[] {
    if (showAll) return list;
    const matchersByFeed = new Map<number, HideMatchers | null>();
    const matchersFor = (feedId: number): HideMatchers | null => {
      if (matchersByFeed.has(feedId)) return matchersByFeed.get(feedId)!;
      const m =
        loadFilterAction(feedId) === "mark-read"
          ? compileMatchers(loadHideRules(feedId))
          : null;
      matchersByFeed.set(feedId, m);
      return m;
    };

    const visible: Entry[] = [];
    const hiddenIds: number[] = [];
    for (const e of list) {
      const m = matchersFor(e.feed.id);
      if (m && isEntryHidden(e, m)) {
        if (e.status === "unread") hiddenIds.push(e.id);
        continue;
      }
      visible.push(e);
    }
    if (hiddenIds.length) void hideMatchedEntries(hiddenIds, list);
    return visible;
  }

  async function hideMatchedEntries(ids: number[], list: Entry[]): Promise<void> {
    try {
      await apiCall("entries", {
        method: "PUT",
        body: JSON.stringify({ entry_ids: ids, status: "read" }),
      });
      for (const id of ids) {
        const e = list.find((x) => x.id === id);
        if (e && e.status === "unread") {
          e.status = "read";
          feeds.updateCounters(e.feed.id, -1);
        }
      }
    } catch {
      // Best-effort: on failure the entries simply stay unread and reappear next load.
    }
  }

  function initShowAll() {
    showAll = storageGetString(SHOW_ALL_KEY) === "true";
  }

  function toggleShowAll() {
    showAll = !showAll;
    storageSet(SHOW_ALL_KEY, String(showAll));
  }

  function setSearchQuery(query: string) {
    searchQuery = query;
  }

  function clearSearch() {
    searchQuery = "";
  }

  async function markRead(entryIds: number[], read: boolean) {
    try {
      await apiCall("entries", {
        method: "PUT",
        body: JSON.stringify({
          entry_ids: entryIds,
          status: read ? "read" : "unread",
        }),
      });

      for (const id of entryIds) {
        const entry = entries.find((e) => e.id === id);
        if (entry) {
          const prevStatus = entry.status;
          entry.status = read ? "read" : "unread";
          if (prevStatus !== entry.status) {
            feeds.updateCounters(entry.feed.id, read ? -1 : 1);
          }
        }
      }
    } catch (e) {
      ui.showError(e instanceof Error ? e.message : "Failed to update status");
    }
  }

  // "Mark all as read" for the current view. The topbar button used to send only the
  // loaded page (≤100 entries), so a feed with a larger unread backlog was left partly
  // unread (e.g. 242 → 142). This marks the *entire* scope instead: Miniflux's native
  // mark-all-as-read endpoints for a feed / category / All (one request, whole backlog),
  // and a paged sweep for the Bookmarks (starred) and search views those endpoints can't
  // express. Counters are re-synced from the server afterwards.
  async function markAllRead(feed: {
    id: number;
    isFeed: boolean;
    apiPath: string;
  }): Promise<void> {
    const isStarred = feed.apiPath.includes("starred=true");
    const searching = searchQuery !== "";
    try {
      if (!isStarred && !searching) {
        if (feed.isFeed) {
          await apiCall(`feeds/${feed.id}/mark-all-as-read`, { method: "PUT" });
        } else if (feed.id === -1) {
          const userId = await currentUserId();
          await apiCall(`users/${userId}/mark-all-as-read`, { method: "PUT" });
        } else {
          await apiCall(`categories/${feed.id}/mark-all-as-read`, {
            method: "PUT",
          });
        }
      } else {
        await markAllReadPaged(feed.apiPath);
      }

      // Reflect it locally: everything unread in the view is now read. In the unread-only
      // view that empties the list; in show-all / search / Bookmarks the entries stay
      // visible, just flipped to read.
      for (const e of entries) if (e.status === "unread") e.status = "read";
      if (!showAll && !isStarred && !searching) {
        entries = entries.filter((e) => e.status === "unread");
      }
      await feeds.loadCounters();
    } catch (e) {
      ui.showError(
        e instanceof Error ? e.message : "Failed to mark all as read",
      );
    }
  }

  // Page through the current view's unread backlog and mark it read in chunks. Used for the
  // Bookmarks (starred) and search views, which have no native mark-all-as-read endpoint.
  async function markAllReadPaged(apiPath: string): Promise<void> {
    const sep = apiPath.includes("?") ? "&" : "?";
    const searchParam = searchQuery
      ? `search=${encodeURIComponent(searchQuery)}&`
      : "";
    const PAGE = 100;
    const MAX = 10000; // safety bound against a runaway sweep
    const ids: number[] = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total && offset < MAX) {
      const data = await apiCall<{ total: number; entries: Entry[] }>(
        `${apiPath}${sep}${searchParam}status=unread&order=published_at&direction=desc&limit=${PAGE}&offset=${offset}`,
      );
      total = data.total ?? 0;
      const page = data.entries || [];
      for (const e of page) ids.push(e.id);
      offset += PAGE;
      if (page.length < PAGE) break;
    }
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      await apiCall("entries", {
        method: "PUT",
        body: JSON.stringify({
          entry_ids: ids.slice(i, i + CHUNK),
          status: "read",
        }),
      });
    }
  }

  // Toggle an entry's starred/bookmark state. Miniflux's per-entry bookmark
  // endpoint takes no body and returns 204, flipping the flag server-side — so
  // we mirror that by flipping the local `starred` after the call succeeds.
  async function toggleBookmark(entryId: number) {
    try {
      await apiCall(`entries/${entryId}/bookmark`, { method: "PUT" });
      const entry = entries.find((e) => e.id === entryId);
      if (entry) entry.starred = !entry.starred;
    } catch (e) {
      ui.showError(e instanceof Error ? e.message : "Failed to update bookmark");
    }
  }

  // Re-scrape the original page (applying the feed's scraper/rewrite rules) and
  // persist it. Miniflux's fetch-content endpoint returns the content but does not
  // save it (as of 2.2.19), so we PUT it back explicitly.
  async function fetchAndStore(entryId: number): Promise<string> {
    const data = await apiCall<{ content: string }>(
      `entries/${entryId}/fetch-content`,
    );
    const content = decodeContent(data.content || "");
    await apiCall(`entries/${entryId}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    const entry = entries.find((e) => e.id === entryId);
    if (entry) {
      entry.content = content;
      // One parse pass here too (thumbnail + description share the Document), mirroring
      // enrichEntries. Read-only thumbnail extraction before the mutating description read.
      const doc = content ? parseContent(content) : null;
      // Reuse pickThumbnail so re-fetch honours the same suppression (github feeds) and
      // custom-cover-rule handling as the initial load, rather than re-deriving inline.
      entry._thumbnailUrl = pickThumbnail(
        entry,
        doc,
        hasCoverRule(loadCoverRule(entry.feed.id)),
      );
      // A re-scrape usually swaps the feed's summary images for the article's real ones, so the
      // archive has to be told about the new set — collected before extractDescription, which
      // mutates the shared doc and strips images out of it.
      if (entry._archiveImages) {
        const urls = collectImageUrls(doc, entry._thumbnailUrl);
        entry._imageUrls = urls;
        requestArchive(urls);
      }
      entry._description = doc ? extractDescription(doc) : "";
    }
    return content;
  }

  // Capabilities lent to source rules' prime() (see $lib/sources): the og scheduler, the feed-icon
  // setter and a retroactive cover-clear over the loaded entries — none reachable from a module.
  const sourceContext: SourceContext = {
    schedule: ogSchedule,
    setFeedIcon: (feedId, url) => feeds.setFeedIcon(feedId, url),
    clearCover: (feedId, url) => {
      for (const e of entries)
        if (e.feed.id === feedId && e._thumbnailUrl === url) e._thumbnailUrl = null;
    },
  };

  // Fill in a missing thumbnail. Lazy and cached: invoked per row from the UI only for image
  // views, runs at most once per article URL. By default reads the page's og:image; if the
  // feed has a custom cover rule, fetches the page HTML and extracts via the CSS selector.
  // A definitive "no image" is cached too (so we don't re-hit pages that have none), but
  // transient failures are not — see the schedule body.
  function ensureThumbnail(entry: Entry): void {
    if (entry._thumbnailUrl || !entry.url) return;
    const source = sourceFor(entry);
    // Some sources never have a usable cover (e.g. github release feeds) — never fetch one.
    if (source?.imageless?.(entry)) return;
    // Let the source prime any async work it needs to answer coverHidden() (e.g. telegram
    // resolves the channel avatar so text-only posts don't show it as a card cover).
    source?.prime?.(entry, sourceContext);
    if (ogCache === null)
      ogCache = storageGet<Record<string, string>>(OG_CACHE_KEY, {});

    const rule = loadCoverRule(entry.feed.id);
    // Key the cache by URL *and* the extraction method, so changing/setting a feed's cover
    // rule re-resolves instead of reusing a '' cached by the previous (e.g. og:image) path.
    const ruleSig = hasCoverRule(rule) ? `${rule.selector}|${rule.attr}` : "";
    const cacheKey = ruleSig ? `${entry.url} ${ruleSig}` : entry.url;

    const cached = ogCache[cacheKey];
    if (cached !== undefined) {
      if (cached && !source?.coverHidden?.(entry, cached, sourceContext))
        entry._thumbnailUrl = cached;
      return;
    }
    if (ogInFlight.has(cacheKey)) return;
    ogInFlight.add(cacheKey);

    ogSchedule(async () => {
      // null = couldn't determine (network error / source 5xx); only a definitive answer
      // ('' = checked, no image | url = found) is cached. Caching a transient failure as ''
      // would permanently hide a cover that's actually there.
      let image: string | null = null;
      try {
        if (hasCoverRule(rule)) {
          const res = await authedFetch(
            `/api/fetch-page?url=${encodeURIComponent(entry.url)}`,
          );
          if (res.ok)
            image =
              extractCover((await res.json())?.html || "", rule, entry.url) ||
              "";
        } else {
          const res = await authedFetch(
            `/api/og-image?url=${encodeURIComponent(entry.url)}`,
          );
          if (res.ok) image = (await res.json())?.url || "";
        }
      } catch {
        /* leave undetermined so a later view can retry */
      } finally {
        ogInFlight.delete(cacheKey);
      }
      if (image === null) return; // transient failure — don't poison the cache
      ogCache![cacheKey] = image;
      scheduleOgCacheFlush();
      if (image) {
        const target = entries.find((e) => e.id === entry.id) ?? entry;
        // A source may drop a resolved cover (e.g. a telegram text post's og:image is the channel
        // avatar). The raw value is still cached above; suppression is applied at read time.
        if (!target._thumbnailUrl && !source?.coverHidden?.(target, image, sourceContext))
          target._thumbnailUrl = image;
      }
    });
  }

  async function refetchContent(entryId: number): Promise<string | null> {
    try {
      return await fetchAndStore(entryId);
    } catch (e) {
      ui.showError(
        e instanceof Error ? e.message : "Failed to re-fetch content",
      );
      return null;
    }
  }

  // Re-fetch content for the latest N entries of a feed, with bounded concurrency to
  // avoid hammering the source site. Useful after changing feed rules. The status
  // filter should match what the user is viewing so the visible list updates in place.
  async function refetchFeedLatest(
    feedId: number,
    limit: number,
    status: "unread" | "all",
    onProgress?: (done: number, total: number) => void,
  ): Promise<{
    total: number;
    ok: number;
    failed: number;
    errors: RefetchError[];
  }> {
    const statusParam = status === "unread" ? "status=unread&" : "";
    const data = await apiCall<{ entries: Entry[] }>(
      `feeds/${feedId}/entries?${statusParam}order=published_at&direction=desc&limit=${limit}`,
    );
    const list = data.entries || [];
    const total = list.length;
    let ok = 0;
    let done = 0;
    const errors: RefetchError[] = [];

    // Bounded to 4 concurrent re-fetches so we don't hammer the source site.
    await mapPool(list, 4, async (entry) => {
      try {
        await fetchAndStore(entry.id);
        ok++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({
          id: entry.id,
          title: entry.title,
          url: entry.url,
          message,
        });
        // Surface the real per-entry reason — the bulk toast only shows a count.
        console.warn(
          `Re-fetch failed for "${entry.title}" (${entry.url}): ${message}`,
        );
      }
      onProgress?.(++done, total);
    });
    return { total, ok, failed: errors.length, errors };
  }

  // Give a just-added block rule immediate effect: Miniflux's filter only discards *future*
  // entries, so already-downloaded matches would linger. Fetch the feed's unread entries, match
  // the (client-side) regex against the same field Miniflux would, mark the hits read, drop them
  // from the current view, and fix the counters. Returns how many were hidden.
  async function blockExistingMatches(
    feedId: number,
    field: "title" | "content" | "url" | "author",
    re: RegExp | null,
  ): Promise<number> {
    if (!re) return 0;
    const data = await apiCall<{ entries: Entry[] }>(
      `feeds/${feedId}/entries?status=unread&limit=100`,
    );
    const fieldValue = (e: Entry): string =>
      field === "title" ? e.title
      : field === "content" ? e.content
      : field === "url" ? e.url
      : e.author;
    const matches = (data.entries || []).filter((e) => re.test(fieldValue(e) ?? ""));
    if (matches.length === 0) return 0;

    const ids = matches.map((e) => e.id);
    await apiCall("entries", {
      method: "PUT",
      body: JSON.stringify({ entry_ids: ids, status: "read" }),
    });
    feeds.updateCounters(feedId, -matches.length);

    const idset = new Set(ids);
    entries = entries.filter((e) => !idset.has(e.id));
    return matches.length;
  }

  // Apply a "mark read" rule set to a feed's whole existing unread backlog (called on save so the
  // choice takes effect immediately, not just on the next per-page load). Pages through unread
  // entries, marks matches read in bulk, updates counters, and drops them from the current view.
  async function applyHideToExisting(
    feedId: number,
    rules: FilterRule[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const matchers = compileMatchers(rules);
    if (matchers.block.length === 0 && matchers.keep.length === 0) return 0;

    const PAGE = 100;
    const MAX = 5000; // safety bound against runaway backlogs
    const toMark: number[] = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total && offset < MAX) {
      const data = await apiCall<{ total: number; entries: Entry[] }>(
        `feeds/${feedId}/entries?status=unread&order=published_at&direction=desc&limit=${PAGE}&offset=${offset}`,
      );
      total = data.total ?? 0;
      const page = data.entries || [];
      for (const e of page) if (isEntryHidden(e, matchers)) toMark.push(e.id);
      offset += PAGE;
      onProgress?.(Math.min(offset, total), total);
      if (page.length < PAGE) break;
    }
    if (toMark.length === 0) return 0;

    // Mark read in chunks to keep each request modest.
    const CHUNK = 500;
    for (let i = 0; i < toMark.length; i += CHUNK) {
      await apiCall("entries", {
        method: "PUT",
        body: JSON.stringify({ entry_ids: toMark.slice(i, i + CHUNK), status: "read" }),
      });
    }
    feeds.updateCounters(feedId, -toMark.length);

    const idset = new Set(toMark);
    for (const e of entries) if (idset.has(e.id)) e.status = "read";
    if (!showAll) entries = entries.filter((e) => !idset.has(e.id));
    return toMark.length;
  }

  function findEntryById(id: number): Entry | null {
    return entries.find((e) => e.id === id) ?? null;
  }

  return {
    get entries() {
      return entries;
    },
    get loading() {
      return loading;
    },
    get showAll() {
      return showAll;
    },
    get searchQuery() {
      return searchQuery;
    },
    loadEntries,
    markRead,
    markAllRead,
    toggleBookmark,
    refetchContent,
    refetchFeedLatest,
    blockExistingMatches,
    applyHideToExisting,
    initShowAll,
    toggleShowAll,
    setSearchQuery,
    clearSearch,
    findEntryById,
    ensureThumbnail,
  };
}

export const entries = createEntriesStore();
