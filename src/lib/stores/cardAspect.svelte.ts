import { storageGet, storageSet } from '$lib/storage';

// Adaptive aspect ratio for the Cards-view image box. Feeds tend to be internally
// consistent (all square album covers, all 16:9 stills), so instead of a fixed box that
// letterboxes/pillarboxes everything, we measure the real ratios of the current view's
// thumbnails, take their (clamped) median, and size the box to match. Uniform feeds then
// fill the box with no bars and no crop; the blurred backdrop only shows for the odd
// off-ratio image in a mixed feed.

const STORAGE_KEY = 'cardAspect_v1';
const DEFAULT_ASPECT = 4 / 3; // before we have enough samples for a view
const MIN_ASPECT = 3 / 4; // 0.75 — tallest box we allow (portrait-leaning feeds)
const MAX_ASPECT = 16 / 9; // 1.78 — widest box we allow
const MIN_SAMPLES = 3; // trust the median only after a few images
const MAX_SAMPLES = 60; // cap the per-view sample buffer

function clamp(r: number): number {
	return Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, r));
}

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function createCardAspect() {
	// Persisted viewKey -> clamped median ratio, so a known feed gets its ratio on the very
	// first paint of the next visit (no reflow once it settles).
	let stored = $state<Record<string, number>>(storageGet(STORAGE_KEY, {}));
	// Session-only raw samples per viewKey, used to recompute the median as images load.
	const samples: Record<string, number[]> = {};

	function record(viewKey: string, ratio: number): void {
		if (!viewKey || !(ratio > 0) || !isFinite(ratio)) return;
		const buf = (samples[viewKey] ??= []);
		buf.push(ratio);
		if (buf.length > MAX_SAMPLES) buf.shift();
		if (buf.length < MIN_SAMPLES) return;
		const next = clamp(median(buf));
		if (stored[viewKey] === next) return;
		stored = { ...stored, [viewKey]: next };
		storageSet(STORAGE_KEY, stored);
	}

	function aspectFor(viewKey: string): number {
		return stored[viewKey] ?? DEFAULT_ASPECT;
	}

	return { record, aspectFor };
}

export const cardAspect = createCardAspect();
