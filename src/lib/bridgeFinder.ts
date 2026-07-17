import type { BridgeMatch } from '$lib/rssbridgeCatalog';
import { authedFetch } from '$lib/api';

// The Add Feed companion to feedFinder.ts: asks the user's RSS-Bridge instance whether it already
// has a purpose-built bridge for the typed domain, so a site with no feed of its own (Bandcamp…)
// doesn't get a hand-rolled CssSelectorBridge when a real bridge exists.
//
// Same contract as findFeeds(): this never throws and never rejects. The offer is a bonus on top of
// feed discovery, so every failure — no instance, unreachable instance, slow instance — degrades to
// "no bridges" and leaves the normal Add Feed path exactly as it was.

// What Add Feed hands to BridgeFeedWizard once the user picks one of the offered bridges.
export interface BridgeChoice {
	bridge: BridgeMatch;
	instance: string;
	sourceUrl: string; // the URL the user typed — shown for context, never parsed for parameters
}

const TIMEOUT_MS = 5000;

export async function findBridges(pageUrl: string, instance: string): Promise<BridgeMatch[]> {
	if (!instance.trim() || !pageUrl.trim()) return [];

	try {
		const query = new URLSearchParams({ instance: instance.trim(), url: pageUrl.trim() });
		const res = await authedFetch(`/api/rss-bridge?${query}`, {
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) return [];

		const data = await res.json();
		return Array.isArray(data?.bridges) ? (data.bridges as BridgeMatch[]) : [];
	} catch {
		// Unreachable instance, timeout, malformed JSON — all mean "no offer to make".
		return [];
	}
}

// Fire-and-forget: fills the server's catalog cache while the user is still typing the URL, so the
// cold 1.2MB read of the instance's bridge list doesn't sit in the submit path.
export function warmBridgeCatalog(instance: string): void {
	if (!instance.trim()) return;
	const query = new URLSearchParams({ instance: instance.trim(), warm: '1' });
	void authedFetch(`/api/rss-bridge?${query}`).catch(() => {});
}
