// Run `task` over each item with at most `limit` running at once: a fixed pool of workers
// pulling from a shared cursor. Resolves when every item has been processed. Each task must
// handle its own errors — a throw would reject the whole pool. Used for the feed-icon and
// category-refresh fan-outs (feeds store) and the re-fetch sweep (entries store).
export async function mapPool<T>(
	items: T[],
	limit: number,
	task: (item: T) => Promise<void>
): Promise<void> {
	let cursor = 0;
	async function worker() {
		while (cursor < items.length) {
			await task(items[cursor++]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}
