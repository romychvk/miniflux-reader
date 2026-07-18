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
	// The URL the user typed. Never parsed client-side; handed to the instance's action=detect so the
	// wizard can prefill (and skip) its form.
	sourceUrl: string;
}

// The instance's own detectParameters() result: which bridge it matched and the query params it
// pulled out of the URL (owner/repo, context, …), ready to map onto the wizard's declared params.
export interface DetectedBridge {
	bridge: string;
	params: Record<string, string>;
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

// Asks the instance to resolve the typed URL to a bridge + parameters (its own action=detect). Same
// never-throws contract as findBridges: any failure returns null and the wizard just shows its form.
export async function detectBridgeParams(
	pageUrl: string,
	instance: string
): Promise<DetectedBridge | null> {
	if (!instance.trim() || !pageUrl.trim()) return null;

	try {
		const query = new URLSearchParams({
			instance: instance.trim(),
			url: pageUrl.trim(),
			detect: '1'
		});
		const res = await authedFetch(`/api/rss-bridge?${query}`, {
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) return null;

		const data = await res.json();
		if (!data || typeof data.bridge !== 'string' || !data.bridge) return null;
		const params =
			data.params && typeof data.params === 'object'
				? (data.params as Record<string, string>)
				: {};
		return { bridge: data.bridge, params };
	} catch {
		return null;
	}
}

// Fire-and-forget: fills the server's catalog cache while the user is still typing the URL, so the
// cold 1.2MB read of the instance's bridge list doesn't sit in the submit path.
export function warmBridgeCatalog(instance: string): void {
	if (!instance.trim()) return;
	const query = new URLSearchParams({ instance: instance.trim(), warm: '1' });
	void authedFetch(`/api/rss-bridge?${query}`).catch(() => {});
}
