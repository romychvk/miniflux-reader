import { authedFetch } from '$lib/api';

// Network half of the image archive: hands source image URLs to /api/images so the server can
// download them while they are still reachable. Kept apart from $lib/imageArchive so that module
// stays pure (and testable without the auth store behind authedFetch).
//
// Fire-and-forget by design. Archiving is an insurance policy against a source disappearing, not
// something a render waits on — a failed batch just means those images are still only hotlinked,
// which is exactly where they started.

const BATCH_SIZE = 100; // matches the endpoint's own per-request cap

// URLs already handed over this session. The server skips what it holds, but there is no reason
// to keep asking it about the same picture every time a list re-renders or the user scrolls back.
const requested = new Set<string>();

export function requestArchive(urls: string[]): void {
	const fresh = urls.filter((u) => !requested.has(u));
	if (fresh.length === 0) return;
	for (const u of fresh) requested.add(u);

	void (async () => {
		for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
			const batch = fresh.slice(i, i + BATCH_SIZE);
			try {
				const res = await authedFetch('/api/images', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ urls: batch })
				});
				// A batch that never reached the server can be worth retrying later in the session;
				// one the server answered has been decided, retry or not.
				if (!res.ok) for (const u of batch) requested.delete(u);
			} catch {
				for (const u of batch) requested.delete(u);
				return; // offline or the app is going away — stop, the next load will ask again
			}
		}
	})();
}
