// Reads an RSS-Bridge instance's `?action=list` catalog and answers "does this instance have a
// ready-made bridge for the domain the user typed?".
//
// Pure and server-safe on purpose: the /api/rss-bridge route imports this, so nothing here may
// touch localStorage or the stores (that's $lib/rssbridge, which is browser-only).
//
// The upstream payload is third-party and large (~1.2MB / 520 bridges on rssbridge.de), so every
// field is treated as untrusted and unknown shapes are skipped rather than thrown on.

export interface BridgeParamOption {
	label: string;
	value: string;
	group?: string; // set when the option came from a nested "optgroup" block
}

export interface BridgeParam {
	name: string; // the QUERY KEY — the object key upstream, e.g. `band`
	label: string; // what to show — upstream's `name` field, e.g. "Band name"
	type: 'text' | 'number' | 'list' | 'checkbox';
	title?: string;
	required?: boolean;
	exampleValue?: string;
	defaultValue?: string;
	options?: BridgeParamOption[]; // `list` only
}

export interface BridgeContext {
	name: string; // '' for a single-context bridge — never sent as ?context=
	params: BridgeParam[];
}

export interface BridgeMatch {
	key: string; // class name → ?bridge=BandcampBridge
	name: string;
	uri: string;
	host: string;
	description?: string;
	icon?: string;
	contexts: BridgeContext[];
}

// Generic/utility bridges (CssSelectorBridge, XPathBridge, FeedMergeBridge…) have no home site of
// their own, so they advertise the rss-bridge repo as their `uri`. Without this they'd all "match"
// github.com. Real GitHub bridges point at github.com/ or gist.github.com/ and survive.
const RSS_BRIDGE_REPO = /^https?:\/\/github\.com\/rss-bridge\/rss-bridge/i;

// RSS-Bridge keys a single-context bridge by PHP's array index (`0`) or an empty string. Neither is
// a context name, and sending ?context=0 breaks the request.
const UNNAMED_CONTEXTS = new Set(['0', '']);

// Not a context: RSS-Bridge merges these params into every other context.
const GLOBAL_CONTEXT = 'global';

const MAX_BRIDGES = 1000;
const MAX_MATCHES = 10;

export function normalizeHost(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return '';
	}
}

// Bidirectional on purpose: the user types `reddit.com` but RedditBridge declares `old.reddit.com`,
// while BandcampBridge declares `bandcamp.com` and the user types `scanner-dd.bandcamp.com`. Doing
// it this way also avoids needing a public-suffix list — `bbc.co.uk` and `other.co.uk` are not
// suffixes of each other, so they don't collide the way an eTLD+1 guess would.
export function hostMatches(a: string, b: string): boolean {
	if (!a || !b) return false;
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function isGenericBridge(uri: string): boolean {
	return RSS_BRIDGE_REPO.test(uri);
}

function asString(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	// `defaultValue` is a number on 120 params and a boolean on 24.
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return undefined;
}

// `values` maps label → value, and may mix flat entries with nested optgroup blocks at the same
// level: { "All categories": "", "Art": { "Paintings": "28-paintings" } }.
function parseOptions(values: unknown): BridgeParamOption[] {
	if (!values || typeof values !== 'object') return [];
	const options: BridgeParamOption[] = [];
	for (const [label, value] of Object.entries(values as Record<string, unknown>)) {
		if (value && typeof value === 'object') {
			for (const [subLabel, subValue] of Object.entries(value as Record<string, unknown>)) {
				const v = asString(subValue);
				if (v !== undefined) options.push({ label: subLabel, value: v, group: label });
			}
			continue;
		}
		const v = asString(value);
		if (v !== undefined) options.push({ label, value: v });
	}
	return options;
}

function parseParam(key: string, raw: unknown): BridgeParam | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;

	// `name` is the human label; the object key is the query param. Mixing these up is the easiest
	// bug here — { tag: { name: 'Tag' } } means ?tag=… labelled "Tag".
	const label = typeof r.name === 'string' && r.name.trim() ? r.name : key;

	const rawType = typeof r.type === 'string' ? r.type : '';
	// `type` is absent on ~280 params upstream; RSS-Bridge's own default is a text box.
	const type: BridgeParam['type'] =
		rawType === 'list' || rawType === 'number' || rawType === 'checkbox' ? rawType : 'text';

	const param: BridgeParam = { name: key, label, type };
	if (typeof r.title === 'string' && r.title.trim()) param.title = r.title;
	if (r.required === true) param.required = true;

	const example = asString(r.exampleValue);
	if (example !== undefined && example !== '') param.exampleValue = example;

	// The bridge's own declared default — not auto-fill from the typed URL.
	const fallback = asString(r.defaultValue);
	if (fallback !== undefined) param.defaultValue = fallback;

	if (type === 'list') param.options = parseOptions(r.values);

	return param;
}

function parseParams(raw: unknown): BridgeParam[] {
	if (!raw || typeof raw !== 'object') return [];
	const params: BridgeParam[] = [];
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const param = parseParam(key, value);
		if (param) params.push(param);
	}
	return params;
}

function parseContexts(raw: unknown): BridgeContext[] {
	if (!raw || typeof raw !== 'object') return [];
	const entries = Object.entries(raw as Record<string, unknown>);

	// Merged into every context below; CodebergBridge keeps its required `username`/`repo` here, so
	// dropping it would build silently broken URLs.
	const globals = parseParams(entries.find(([key]) => key === GLOBAL_CONTEXT)?.[1]);

	const named = entries.filter(([key]) => key !== GLOBAL_CONTEXT && !UNNAMED_CONTEXTS.has(key));
	if (named.length > 0) {
		return named.map(([name, params]) => ({ name, params: [...globals, ...parseParams(params)] }));
	}

	// Single-context bridge: keyed by `0` or ''. Its params still need the globals merged in, and
	// the empty name tells the caller not to send ?context=.
	const single = entries.find(([key]) => UNNAMED_CONTEXTS.has(key));
	const params = [...globals, ...parseParams(single?.[1])];
	return params.length > 0 || single ? [{ name: '', params }] : [];
}

export function buildCatalog(raw: unknown): BridgeMatch[] {
	const bridges = (raw as { bridges?: unknown } | null)?.bridges;
	if (!bridges || typeof bridges !== 'object') return [];

	const catalog: BridgeMatch[] = [];
	for (const [key, value] of Object.entries(bridges as Record<string, unknown>).slice(0, MAX_BRIDGES)) {
		if (!value || typeof value !== 'object') continue;
		const v = value as Record<string, unknown>;

		// `status` mirrors the instance's enabled_bridges config.
		if (v.status !== 'active') continue;
		if (typeof v.uri !== 'string' || !v.uri) continue;
		if (isGenericBridge(v.uri)) continue;

		const host = normalizeHost(v.uri);
		if (!host) continue;

		const match: BridgeMatch = {
			key,
			name: typeof v.name === 'string' && v.name.trim() ? v.name : key,
			uri: v.uri,
			host,
			contexts: parseContexts(v.parameters)
		};
		if (typeof v.description === 'string' && v.description.trim()) match.description = v.description;
		if (typeof v.icon === 'string' && v.icon.trim()) match.icon = v.icon;

		catalog.push(match);
	}
	return catalog;
}

export function matchBridges(catalog: BridgeMatch[], pageUrl: string): BridgeMatch[] {
	const host = normalizeHost(pageUrl);
	if (!host) return [];

	return catalog
		.filter((bridge) => hostMatches(host, bridge.host))
		.sort((a, b) => {
			// An exact host is a better answer than a parent/child domain.
			const exact = Number(b.host === host) - Number(a.host === host);
			return exact !== 0 ? exact : a.name.localeCompare(b.name);
		})
		.slice(0, MAX_MATCHES);
}
