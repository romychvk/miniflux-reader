import type { Action } from "svelte/action";
import type { Entry } from "$lib/types";
import { entries } from "$lib/stores/entries.svelte";
import { ui } from "$lib/stores/ui.svelte";

// Auto-mark-read on scroll, driven by a SINGLE IntersectionObserver shared across every row in
// the list. The previous implementation created one observer per row (~100 on a full page); each
// row now registers its element + entry via `use:autoMarkRead={entry}` and the shared observer
// looks the element up on each intersection change.
//
// Geometry is unchanged from the per-row version: a row is marked read only when it leaves the
// viewport past the TOP edge — i.e. the user scrolled down past it. Leaving via the bottom
// (scrolling back up) must never mark read. Comparing the row's bounding rect against the root
// bounds tells us which edge it left, so no global scroll-direction tracking is needed, and it
// works with the nested <main> scroll container.

interface Tracked {
  entry: Entry;
  prevInView: boolean;
}

let observer: IntersectionObserver | null = null;
const tracked = new Map<Element, Tracked>();

function onIntersect(records: IntersectionObserverEntry[]): void {
  for (const record of records) {
    const t = tracked.get(record.target);
    if (!t) continue;
    const inView = record.isIntersecting;
    if (
      !inView &&
      t.prevInView &&
      t.entry.status === "unread" &&
      ui.autoMarkReadOnScroll &&
      !ui.isMarkReadSuppressed &&
      record.boundingClientRect.bottom <= (record.rootBounds?.top ?? 0)
    ) {
      entries.markRead([t.entry.id], true);
    }
    t.prevInView = inView;
  }
}

export const autoMarkRead: Action<HTMLElement, Entry> = (node, entry) => {
  // Lazily create the shared observer, rooted at the list's scroll container. Every row lives
  // under the same <main>, so the root taken from the first-registered row applies to all.
  if (!observer) {
    observer = new IntersectionObserver(onIntersect, {
      root: node.closest("main"),
      threshold: 0,
    });
  }
  tracked.set(node, { entry, prevInView: false });
  observer.observe(node);

  return {
    update(next: Entry) {
      // Keyed rows are reused across list reloads with a fresh entry object of the same id;
      // keep the tracked reference current so the status read and mark-read hit the live entry.
      const t = tracked.get(node);
      if (t) t.entry = next;
    },
    destroy() {
      observer?.unobserve(node);
      tracked.delete(node);
      // Drop the shared observer once the list empties so the next list re-roots a fresh one
      // (defends against the <main> scroll container ever being replaced).
      if (observer && tracked.size === 0) {
        observer.disconnect();
        observer = null;
      }
    },
  };
};
