// Helpers for decomposing/recomposing an RSS-Bridge feed URL, e.g.
//   https://rssbridge.de/?action=display&bridge=FilterBridge&url=<feed>&filter=…&format=Atom
// The settings UI lets the user edit the parts and toggle the bridge on/off; when off, the
// feed_url becomes the bare `url` param (direct feed) and the bridge config is kept in
// localStorage (Miniflux has no field to hold it). See FeedSettings.svelte.

export interface RssBridgeParam {
	key: string;
	value: string;
}

// Which query param carries the source: `url` for feed-wrapping bridges (FilterBridge…),
// `home_page` for page-scraping ones (CssSelectorBridge).
export type RssBridgeSourceKey = 'url' | 'home_page';

export interface RssBridgeConfig {
	instance: string; // origin + path, e.g. "https://rssbridge.de/"
	bridge: string; // e.g. "FilterBridge"
	sourceUrl: string; // the source param — the underlying feed or scraped page
	sourceKey?: RssBridgeSourceKey; // defaults to 'url' (saved configs predate this field)
	params: RssBridgeParam[]; // every query param except action/bridge/source
}

export const RSS_BRIDGE_STORAGE_PREFIX = 'rssbridge:';

// The user's preferred instance (global, not per-feed) — safe under the same prefix
// because per-feed keys are numeric ('rssbridge:123').
export const RSS_BRIDGE_INSTANCE_KEY = 'rssbridge:instance';

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

	// `url` wins when both are present (home_page then stays a generic param) — lossless.
	const sourceKey: RssBridgeSourceKey =
		!u.searchParams.has('url') && u.searchParams.has('home_page') ? 'home_page' : 'url';

	const structured = new Set(['action', 'bridge', sourceKey]);
	const params: RssBridgeParam[] = [];
	for (const [key, value] of u.searchParams) {
		if (!structured.has(key)) params.push({ key, value });
	}

	return {
		instance: u.origin + u.pathname,
		bridge: u.searchParams.get('bridge') ?? '',
		sourceUrl: u.searchParams.get(sourceKey) ?? '',
		sourceKey,
		params
	};
}

export function buildRssBridgeUrl(cfg: RssBridgeConfig): string {
	// Fall back to the user's own instance if the field was cleared, so the result stays valid.
	const base = cfg.instance.trim() || 'https://rssbridge.de/';
	const u = new URL(base);
	u.search = ''; // drop any stray query on the instance URL
	u.searchParams.set('action', 'display');
	u.searchParams.set('bridge', cfg.bridge.trim());
	const source = cfg.sourceUrl.trim();
	if (source) u.searchParams.set(cfg.sourceKey ?? 'url', source);
	for (const { key, value } of cfg.params) {
		const k = key.trim();
		if (k) u.searchParams.set(k, value);
	}
	return u.toString();
}
