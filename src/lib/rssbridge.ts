// Helpers for decomposing/recomposing an RSS-Bridge feed URL, e.g.
//   https://rssbridge.de/?action=display&bridge=FilterBridge&url=<feed>&filter=…&format=Atom
// The settings UI lets the user edit the parts and toggle the bridge on/off; when off, the
// feed_url becomes the bare `url` param (direct feed) and the bridge config is kept in
// localStorage (Miniflux has no field to hold it). See FeedSettings.svelte.

export interface RssBridgeParam {
	key: string;
	value: string;
}

export interface RssBridgeConfig {
	instance: string; // origin + path, e.g. "https://rssbridge.de/"
	bridge: string; // e.g. "FilterBridge"
	sourceUrl: string; // the `url` param — the direct underlying feed
	params: RssBridgeParam[]; // every query param except action/bridge/url
}

export const RSS_BRIDGE_STORAGE_PREFIX = 'rssbridge:';

// Structured params handled by their own fields; everything else becomes an editable row.
const STRUCTURED_KEYS = new Set(['action', 'bridge', 'url']);

// A feed_url is an rssbridge URL if it carries a `bridge` query param.
export function isRssBridgeUrl(url: string): boolean {
	try {
		return new URL(url).searchParams.has('bridge');
	} catch {
		return false;
	}
}

export function parseRssBridgeUrl(url: string): RssBridgeConfig | null {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return null;
	}
	if (!u.searchParams.has('bridge')) return null;

	const params: RssBridgeParam[] = [];
	for (const [key, value] of u.searchParams) {
		if (!STRUCTURED_KEYS.has(key)) params.push({ key, value });
	}

	return {
		instance: u.origin + u.pathname,
		bridge: u.searchParams.get('bridge') ?? '',
		sourceUrl: u.searchParams.get('url') ?? '',
		params
	};
}

export function buildRssBridgeUrl(cfg: RssBridgeConfig): string {
	// Fall back to the public instance if the field was cleared, so the result stays valid.
	const base = cfg.instance.trim() || 'https://rssbridge.de/';
	const u = new URL(base);
	u.search = ''; // drop any stray query on the instance URL
	u.searchParams.set('action', 'display');
	u.searchParams.set('bridge', cfg.bridge.trim());
	u.searchParams.set('url', cfg.sourceUrl.trim());
	for (const { key, value } of cfg.params) {
		const k = key.trim();
		if (k) u.searchParams.set(k, value);
	}
	return u.toString();
}
