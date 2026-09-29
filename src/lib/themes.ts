/**
 * Theme model: the design-token contract, the built-in presets, and the
 * OKLCH ramp generator. This file is the single source of truth for theme
 * colors — the `:root` block in app.css only mirrors the default preset as a
 * pre-JS fallback.
 *
 * A theme is `inputs` (the simple-editor controls: mode + accent + neutral
 * tint, from which every token can be generated) plus `overrides` (advanced
 * per-token tweaks layered on top). Presets pin ALL tokens in `overrides` so
 * they render exactly as hand-tuned; their `inputs` are calibrated seeds that
 * take over as soon as a duplicated copy touches a simple control.
 *
 * Presets (and custom themes made in the current editor) are PAIRED: the theme
 * itself is the light variant and `dark` carries the other one. Which variant
 * renders is the global mode preference (light / dark / system), see
 * `variantFor`. Custom themes saved before pairing existed are single-mode:
 * they have no `dark` and always render as authored.
 */

import { hexToOklch, oklchToHex } from '$lib/color';

export const TOKENS = [
	'n-50', 'n-100', 'n-200', 'n-300', 'n-400', 'n-500', 'n-600', 'n-700', 'n-800', 'n-900',
	'a-50', 'a-400', 'a-500', 'a-600', 'a-700',
	'surface',
	'danger', 'danger-strong', 'success', 'warning', 'overlay', 'on-accent',
	'sidebar', 'navbar', 'sidebar-fg', 'navbar-fg',
	'rail', 'rail-fg',
] as const;

export type Token = (typeof TOKENS)[number];
export type TokenMap = Record<Token, string>; // hex values

export type Mode = 'light' | 'dark';
export type ModePref = Mode | 'system';

/** Rail source: the accent, a neutral strip, or a custom hex. Absent = the pre-pairing
 *  behavior (accent on light, page background on dark). */
export type RailInput = 'accent' | 'neutral' | string;

export interface ThemeInputs {
	mode: Mode;
	/** Accent base color — becomes the a-600 step */
	accent: string;
	/** Neutral tint — hue/chroma source for the n-* ramp and dark surfaces */
	tint: string;
	rail?: RailInput;
}

/** One renderable variant: generator seeds plus per-token tweaks. */
export interface ThemeVariant {
	inputs: ThemeInputs;
	overrides: Partial<TokenMap>;
}

export interface DarkVariant extends ThemeVariant {
	/** Generated from the light variant at save time ("Derive from light" in the editor). */
	derived?: boolean;
}

export interface Theme extends ThemeVariant {
	id: string;
	label: string;
	/** Short description shown under the palette name. */
	hint?: string;
	/** The dark variant of a paired theme. Absent = single-mode theme. */
	dark?: DarkVariant;
}

/** The variant a theme renders in `mode`; single-mode themes ignore the mode. */
export function variantFor(t: Theme, mode: Mode): ThemeVariant {
	return mode === 'dark' && t.dark ? t.dark : t;
}

/** The mode a single-mode theme is locked to, or null for a paired one. */
export function singleMode(t: Theme): Mode | null {
	return t.dark ? null : t.inputs.mode;
}

const N_STEPS = TOKENS.slice(0, 10);

// Lightness curves measured from the hand-tuned Tailwind slate ramp (light)
// and this app's dark palette, so generated ramps match the presets' rhythm.
const N_LIGHT_L = [0.985, 0.967, 0.929, 0.869, 0.704, 0.554, 0.446, 0.372, 0.279, 0.208];
const N_DARK_L = [0.18, 0.215, 0.26, 0.325, 0.53, 0.64, 0.76, 0.86, 0.93, 0.96];
// Chroma envelope per step, as a fraction of the tint's (capped) chroma —
// near-white/near-black steps carry less color than the mid-tones.
const N_C = [0.07, 0.15, 0.28, 0.48, 0.87, 1.0, 0.94, 0.96, 0.89, 0.91];

const SEMANTIC_LIGHT = {
	danger: '#dc2626',
	'danger-strong': '#b91c1c',
	success: '#16a34a',
	warning: '#b45309',
	overlay: '#000000',
} as const;

const SEMANTIC_DARK = {
	danger: '#ef4444',
	'danger-strong': '#dc2626',
	success: '#22c55e',
	warning: '#f59e0b',
	overlay: '#000000',
} as const;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const genCache = new Map<string, TokenMap>();

/** Generate all 22 tokens from the three simple-mode inputs. */
export function generateTokens(inputs: ThemeInputs): TokenMap {
	const key = `${inputs.mode}|${inputs.accent}|${inputs.tint}|${inputs.rail ?? ''}`;
	const cached = genCache.get(key);
	if (cached) return cached;

	const dark = inputs.mode === 'dark';
	const tint = hexToOklch(inputs.tint);
	const accent = hexToOklch(inputs.accent);
	const cMax = Math.min(tint.c, 0.05);

	const map = {} as TokenMap;
	const nL = dark ? N_DARK_L : N_LIGHT_L;
	// The chroma envelope follows lightness (near-white steps stay subtle);
	// the dark ramp inverts lightness, so the envelope flips with it.
	const nC = dark ? [...N_C].reverse() : N_C;
	N_STEPS.forEach((step, i) => {
		map[step] = oklchToHex({ l: nL[i], c: cMax * nC[i], h: tint.h });
	});

	const al = clamp(accent.l, 0.35, 0.75);
	map['a-600'] = oklchToHex({ l: al, c: accent.c, h: accent.h });
	map['a-500'] = oklchToHex({ l: al + 0.07, c: accent.c * 0.92, h: accent.h });
	map['a-400'] = oklchToHex({ l: al + 0.14, c: accent.c * 0.75, h: accent.h });
	// a-700 is the prose-link color: darker than the accent on light themes,
	// lighter on dark ones (matches the dark preset's orange-300 link color).
	map['a-700'] = dark
		? oklchToHex({ l: al + 0.25, c: accent.c * 0.55, h: accent.h })
		: oklchToHex({ l: al - 0.11, c: accent.c * 0.85, h: accent.h });
	map['a-50'] = dark
		? oklchToHex({ l: 0.2, c: 0.03, h: accent.h })
		: oklchToHex({ l: 0.975, c: 0.015, h: accent.h });

	map.surface = dark ? oklchToHex({ l: 0.225, c: cMax * 0.5, h: tint.h }) : '#ffffff';
	// Sidebar / navbar chrome follows the surface unless explicitly overridden;
	// their text follows the strongest neutral (see resolveTheme for the
	// contrast-derived value used when a zone background is customized).
	map.sidebar = map.surface;
	map.navbar = map.surface;
	map['sidebar-fg'] = map['n-900'];
	map['navbar-fg'] = map['n-900'];
	Object.assign(map, deriveRail(inputs, map));

	Object.assign(map, dark ? SEMANTIC_DARK : SEMANTIC_LIGHT);
	// Light accents (yellow, lime) need dark label text; the darkest neutral
	// is n-900 on light themes and n-50 on dark ones (the ramp is inverted).
	map['on-accent'] = al < 0.7 ? '#ffffff' : map[dark ? 'n-50' : 'n-900'];

	genCache.set(key, map);
	return map;
}

/**
 * The desktop rail (the narrow strip left of the feed tree) from `inputs.rail` and the
 * (possibly overridden) accent / neutrals already in `map`.
 * - accent: the accent itself on light; on dark a muted, darker tone of it — a full-accent
 *   strip would be the loudest thing on screen.
 * - neutral: a light-gray strip on light; on dark it sinks below the page.
 * - hex: that color, with contrast-derived text.
 * - absent (single-mode themes saved before rail inputs existed): accent on light, the page
 *   background on dark.
 */
function deriveRail(inputs: ThemeInputs, map: Pick<TokenMap, 'a-600' | 'n-50' | 'n-500' | 'n-600'>): {
	rail: string;
	'rail-fg': string;
} {
	const dark = inputs.mode === 'dark';
	const r = inputs.rail;
	if (r?.startsWith('#')) return { rail: r, 'rail-fg': mixOklab(r, contrastFg(r), 0.8) };
	if (r === 'neutral') {
		const t = hexToOklch(inputs.tint);
		const c = Math.min(t.c, 0.05) * 0.3;
		if (!dark) return { rail: oklchToHex({ l: 0.94, c, h: t.h }), 'rail-fg': map['n-600'] };
		const rail = oklchToHex({ l: 0.15, c: c * 0.66, h: t.h });
		return { rail, 'rail-fg': mixOklab(rail, '#ffffff', 0.62) };
	}
	if (r === 'accent' && dark) {
		const a = hexToOklch(map['a-600']);
		const rail = oklchToHex({ l: 0.3, c: Math.min(a.c * 0.55, 0.09), h: a.h });
		return { rail, 'rail-fg': mixOklab(rail, '#ffffff', 0.62) };
	}
	return dark
		? { rail: map['n-50'], 'rail-fg': map['n-500'] }
		: { rail: map['a-600'], 'rail-fg': mixOklab(map['a-600'], '#ffffff', 0.72) };
}

const pairedCache = new Map<string, TokenMap>();

/**
 * The dark variant of a paired theme, from the same seeds as its light variant ("Derive
 * from light"). Unlike the single-mode dark generator it keeps neutrals near-gray (a fixed
 * low chroma, scaled by how tinted the seed is) and lifts the accent for contrast, with
 * links / selected text lighter still. The presets' dark variants were produced by this
 * and then pinned.
 */
export function generatePairedDark(inputs: ThemeInputs): TokenMap {
	const key = `${inputs.accent}|${inputs.tint}|${inputs.rail ?? ''}`;
	const cached = pairedCache.get(key);
	if (cached) return cached;

	const tint = hexToOklch(inputs.tint);
	const accent = hexToOklch(inputs.accent);
	// Indigo's tint (chroma ≈ 0.0355) is the fully-tinted reference.
	const strength = clamp(tint.c / 0.0355, 0.3, 1);
	const nc = 0.012 * Math.max(strength, 0.5);
	const env = [...N_C].reverse();

	const map = {} as TokenMap;
	N_STEPS.forEach((step, i) => {
		map[step] = oklchToHex({ l: N_DARK_L[i], c: nc * env[i], h: tint.h });
	});
	map.surface = oklchToHex({ l: 0.225, c: nc * 0.5, h: tint.h });

	const al = Math.max(accent.l, 0.62);
	const c = accent.c;
	map['a-600'] = oklchToHex({ l: al, c: c * 0.95, h: accent.h });
	map['a-500'] = oklchToHex({ l: al + 0.06, c: c * 0.9, h: accent.h });
	map['a-400'] = oklchToHex({ l: al + 0.12, c: c * 0.75, h: accent.h });
	map['a-700'] = oklchToHex({ l: al + 0.16, c: c * 0.6, h: accent.h });
	map['a-50'] = oklchToHex({ l: 0.26, c: Math.min(0.04, c * 0.3), h: accent.h });

	map.sidebar = map.surface;
	map.navbar = map.surface;
	map['sidebar-fg'] = map['n-900'];
	map['navbar-fg'] = map['n-900'];

	// A custom rail color maps like the accent when it is dark enough to carry white text
	// (a muted tone of its own hue), and like a neutral strip otherwise.
	let rail = inputs.rail;
	let railHue = accent.h;
	if (rail?.startsWith('#')) {
		const rc = hexToOklch(rail);
		railHue = rc.h;
		rail = rc.l < 0.72 ? 'accent' : 'neutral';
	}
	if (rail === 'neutral') {
		Object.assign(map, deriveRail({ ...inputs, mode: 'dark', rail: 'neutral' }, map));
	} else {
		map.rail = oklchToHex({ l: 0.3, c: Math.min(c * 0.55, 0.09), h: railHue });
		map['rail-fg'] = mixOklab(map.rail, '#ffffff', 0.62);
	}

	Object.assign(map, SEMANTIC_DARK);
	map['on-accent'] = al < 0.7 ? '#ffffff' : map['n-50'];

	pairedCache.set(key, map);
	return map;
}

// The zone tokens follow the surface unless explicitly overridden; pinning them would mark
// the zone as customized (see resolveThemeCss).
const ZONE_TOKENS: readonly Token[] = ['sidebar', 'navbar', 'sidebar-fg', 'navbar-fg'];

/** A generated map as `overrides`: every token pinned except the surface-following zones. */
export function pinTokens(map: TokenMap): Partial<TokenMap> {
	const out: Partial<TokenMap> = { ...map };
	for (const z of ZONE_TOKENS) delete out[z];
	return out;
}

/** The entries of `overrides` that differ from `base` — the manual tweaks. */
export function tweaksOver(overrides: Partial<TokenMap>, base: TokenMap): Partial<TokenMap> {
	const out: Partial<TokenMap> = {};
	for (const [k, v] of Object.entries(overrides) as [Token, string][]) {
		if (v && v.toLowerCase() !== base[k]?.toLowerCase()) out[k] = v;
	}
	return out;
}

/** Swatch stops for a theme tile: light n-200 | light a-600 | dark surface for a paired
 *  theme, n-200 | a-600 of its only variant for a single-mode one. */
export function swatchOf(t: Theme): string[] {
	const light = resolveTheme(t);
	return t.dark
		? [light['n-200'], light['a-600'], resolveTheme(t.dark).surface]
		: [light['n-200'], light['a-600']];
}

/** Contrast text for a customized zone background: light text on dark, dark on light. */
function contrastFg(bg: string): string {
	const c = hexToOklch(bg);
	const chroma = Math.min(c.c, 0.03);
	return c.l >= 0.5
		? oklchToHex({ l: 0.22, c: chroma, h: c.h })
		: oklchToHex({ l: 0.93, c: chroma, h: c.h });
}

export function resolveTheme(t: ThemeVariant): TokenMap {
	const map = { ...generateTokens(t.inputs), ...t.overrides };
	// Keep sidebar/navbar glued to the (possibly overridden) surface unless the
	// theme overrides them explicitly — presets and pre-existing custom themes
	// carry no sidebar/navbar overrides and must keep looking as before.
	if (!('sidebar' in t.overrides)) map.sidebar = map.surface;
	if (!('navbar' in t.overrides)) map.navbar = map.surface;
	// Zone text: explicit override wins; a customized zone background derives a
	// contrasting color (dark sidebar in a light theme → light text); an
	// untouched zone keeps the theme's strongest neutral.
	if (!('sidebar-fg' in t.overrides))
		map['sidebar-fg'] = 'sidebar' in t.overrides ? contrastFg(map.sidebar) : map['n-900'];
	if (!('navbar-fg' in t.overrides))
		map['navbar-fg'] = 'navbar' in t.overrides ? contrastFg(map.navbar) : map['n-900'];
	// The rail follows the (possibly overridden) accent / page background the same way — themes
	// saved before the rail existed pin a-600 and n-50 but know nothing about it.
	const rail = deriveRail(t.inputs, map);
	if (!('rail' in t.overrides)) map.rail = rail.rail;
	if (!('rail-fg' in t.overrides))
		map['rail-fg'] =
			'rail' in t.overrides ? mixOklab(map.rail, contrastFg(map.rail), 0.8) : rail['rail-fg'];
	return map;
}

// Position of each neutral step between the zone background (0) and the zone
// text (1), measured from the lightness spacing of the canonical light ramp.
const ZONE_T: Record<string, number> = {
	'200': 0.072, '300': 0.149, '400': 0.362, '500': 0.555,
	'600': 0.694, '700': 0.789, '800': 0.909, '900': 1,
};

/** OKLab midpoint between two hexes at position t (0 = a, 1 = b). */
function mixOklab(a: string, b: string, t: number): string {
	const ca = hexToOklch(a);
	const cb = hexToOklch(b);
	const ra = (ca.h * Math.PI) / 180;
	const rb = (cb.h * Math.PI) / 180;
	const A = ca.c * Math.cos(ra) + (cb.c * Math.cos(rb) - ca.c * Math.cos(ra)) * t;
	const B = ca.c * Math.sin(ra) + (cb.c * Math.sin(rb) - ca.c * Math.sin(ra)) * t;
	let h = (Math.atan2(B, A) * 180) / Math.PI;
	if (h < 0) h += 360;
	return oklchToHex({ l: ca.l + (cb.l - ca.l) * t, c: Math.hypot(A, B), h });
}

/**
 * All CSS variables a theme applies, including the derived per-zone neutral
 * mirrors (--sidebar-n-200…900, --navbar-n-200…900) used by the sb-* / nb-*
 * utilities. Untouched zones copy the base ramp verbatim (pixel-identical);
 * customized zones interpolate between the zone background and zone text so
 * hovers, borders and muted text keep their hierarchy on any background.
 */
export function resolveThemeCss(t: ThemeVariant): Record<string, string> {
	const map = resolveTheme(t);
	const vars: Record<string, string> = { ...map };
	for (const zone of ['sidebar', 'navbar'] as const) {
		const customized = zone in t.overrides || `${zone}-fg` in t.overrides;
		for (const [step, pos] of Object.entries(ZONE_T)) {
			vars[`${zone}-n-${step}`] = customized
				? mixOklab(map[zone], map[`${zone}-fg` as Token], pos)
				: map[`n-${step}` as Token];
		}
	}
	// Rail states, derived rather than editable: a dark rail gets a white tile carrying the rail's
	// own color (logo, active item, badge, avatar); a light or neutral one gets an accent tile.
	// rail-strong is the hover text — the rail's far end from its background.
	// Generous threshold: mid-lightness accents (the default blue sits at L≈0.55) still carry
	// white; only genuinely pale rails (yellow, lime) switch to dark text and an accent tile.
	const railDark = hexToOklch(map.rail).l < 0.72;
	const accentTile = t.inputs.mode === 'dark' || !railDark;
	vars['rail-active'] = accentTile ? map['a-600'] : '#ffffff';
	vars['rail-active-fg'] = accentTile ? map['on-accent'] : map.rail;
	vars['rail-strong'] = railDark ? '#ffffff' : map['n-900'];
	return vars;
}

// Every preset is a palette with two hand-tuned variants (all tokens pinned). The light ones
// share Indigo's measured lightness curve, so tints change only the hue; the dark ones come
// from generatePairedDark and were then pinned, so they no longer move with the generator
// (`derived` only tells the editor to start with "Derive from light" ticked; Sepia's dark
// accent was lifted by hand, so a copy of it starts unticked).
export const PRESETS: readonly Theme[] = [
	{
		id: 'indigo',
		label: 'Indigo',
		hint: 'blue-violet',
		inputs: { mode: 'light', accent: '#3438a8', tint: '#8e90a8', rail: 'accent' },
		overrides: {
			'n-50': '#f4f4fa', 'n-100': '#f1f1f8', 'n-200': '#e4e5f0', 'n-300': '#c3c4d8', 'n-400': '#8e90a8',
			'n-500': '#61637d', 'n-600': '#4c4e68', 'n-700': '#3a3c55', 'n-800': '#23243a', 'n-900': '#15162a',
			'a-50': '#ececfc', 'a-400': '#8b8de6', 'a-500': '#5457d6', 'a-600': '#3438a8', 'a-700': '#3f42b5',
			surface: '#ffffff', rail: '#3438a8', 'rail-fg': '#c9caf0',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
		dark: {
			derived: true,
			inputs: { mode: 'dark', accent: '#3438a8', tint: '#8e90a8', rail: 'accent' },
			overrides: {
				'n-50': '#111116', 'n-100': '#18191e', 'n-200': '#23232a', 'n-300': '#33343a', 'n-400': '#6a6b73',
				'n-500': '#8b8b93', 'n-600': '#b0b1b5', 'n-700': '#d0d1d3', 'n-800': '#e7e8e9', 'n-900': '#f2f2f2',
				'a-50': '#1e2237', 'a-400': '#92a4fd', 'a-500': '#7b8ef8', 'a-600': '#697ae9', 'a-700': '#a2b2fb',
				surface: '#1b1b1f', rail: '#21285a', 'rail-fg': '#a2a8bf',
				...SEMANTIC_DARK, 'on-accent': '#ffffff',
			},
		},
	},
	{
		id: 'aqua',
		label: 'Aqua',
		hint: 'navy rail · blue',
		inputs: { mode: 'light', accent: '#1c6fd4', tint: '#6b7a99', rail: '#1f4e8c' },
		overrides: {
			'n-50': '#f3f5f9', 'n-100': '#f0f2f6', 'n-200': '#e2e6ed', 'n-300': '#c0c6d3', 'n-400': '#8b92a2',
			'n-500': '#5d6677', 'n-600': '#485162', 'n-700': '#373e4f', 'n-800': '#202635', 'n-900': '#121825',
			'a-50': '#e7f5ff', 'a-400': '#649deb', 'a-500': '#3f86e4', 'a-600': '#1c6fd4', 'a-700': '#155eb6',
			surface: '#ffffff', rail: '#1f4e8c', 'rail-fg': '#bdcce0',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
		dark: {
			derived: true,
			inputs: { mode: 'dark', accent: '#1c6fd4', tint: '#6b7a99', rail: '#1f4e8c' },
			overrides: {
				'n-50': '#101215', 'n-100': '#18191d', 'n-200': '#222428', 'n-300': '#323438', 'n-400': '#696c71',
				'n-500': '#8a8c91', 'n-600': '#b0b1b4', 'n-700': '#d0d1d2', 'n-800': '#e7e8e9', 'n-900': '#f1f2f2',
				'a-50': '#172537', 'a-400': '#73adfc', 'a-500': '#5399f6', 'a-600': '#3b85e7', 'a-700': '#8cbaf9',
				surface: '#1b1c1e', rail: '#092d5a', 'rail-fg': '#9baabf',
				...SEMANTIC_DARK, 'on-accent': '#ffffff',
			},
		},
	},
	{
		id: 'light',
		label: 'Light',
		hint: 'gray rail · blue',
		inputs: { mode: 'light', accent: '#1c6fd4', tint: '#6b7280', rail: 'neutral' },
		overrides: {
			'n-50': '#f4f5f7', 'n-100': '#f1f2f4', 'n-200': '#e4e6e9', 'n-300': '#c3c6cc', 'n-400': '#8e929a',
			'n-500': '#61666e', 'n-600': '#4c5159', 'n-700': '#3a3f47', 'n-800': '#23272e', 'n-900': '#15181f',
			'a-50': '#e7f5ff', 'a-400': '#649deb', 'a-500': '#3f86e4', 'a-600': '#1c6fd4', 'a-700': '#155eb6',
			surface: '#ffffff', rail: '#e9ebf0', 'rail-fg': '#4c5159',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
		dark: {
			derived: true,
			inputs: { mode: 'dark', accent: '#1c6fd4', tint: '#6b7280', rail: 'neutral' },
			overrides: {
				'n-50': '#101214', 'n-100': '#18191c', 'n-200': '#232427', 'n-300': '#333437', 'n-400': '#6a6c6f',
				'n-500': '#8a8c8f', 'n-600': '#b0b1b3', 'n-700': '#d0d1d2', 'n-800': '#e7e8e8', 'n-900': '#f1f2f2',
				'a-50': '#172537', 'a-400': '#73adfc', 'a-500': '#5399f6', 'a-600': '#3b85e7', 'a-700': '#8cbaf9',
				surface: '#1b1c1d', rail: '#0a0b0d', 'rail-fg': '#979798',
				...SEMANTIC_DARK, 'on-accent': '#ffffff',
			},
		},
	},
	{
		id: 'sepia',
		label: 'Sepia',
		hint: 'warm · sienna',
		inputs: { mode: 'light', accent: '#8f5a2a', tint: '#8a7f78', rail: 'neutral' },
		overrides: {
			'n-50': '#f7f4f2', 'n-100': '#f4f1ef', 'n-200': '#eae5e1', 'n-300': '#cdc4be', 'n-400': '#9b9088',
			'n-500': '#6f635a', 'n-600': '#5a4e46', 'n-700': '#483c34', 'n-800': '#2f241d', 'n-900': '#201610',
			'a-50': '#fff0e4', 'a-400': '#b28765', 'a-500': '#a27045', 'a-600': '#8f5a2a', 'a-700': '#794b21',
			surface: '#ffffff', rail: '#ebe7e3', 'rail-fg': '#5a4e46',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
		dark: {
			inputs: { mode: 'dark', accent: '#8f5a2a', tint: '#8a7f78', rail: 'neutral' },
			overrides: {
				'n-50': '#14110f', 'n-100': '#1b1917', 'n-200': '#262321', 'n-300': '#363331', 'n-400': '#6f6b68',
				'n-500': '#8f8b89', 'n-600': '#b2b0af', 'n-700': '#d2d1d0', 'n-800': '#e8e8e7', 'n-900': '#f2f2f1',
				'a-50': '#2e2116', 'a-400': '#d9ad8a', 'a-500': '#cc986e', 'a-600': '#ba8558', 'a-700': '#e0bca0',
				surface: '#1d1b1a', rail: '#0c0b0a', 'rail-fg': '#989797',
				...SEMANTIC_DARK, 'on-accent': '#ffffff',
			},
		},
	},
	{
		id: 'moss',
		label: 'Moss',
		hint: 'sage green',
		inputs: { mode: 'light', accent: '#3f7d5a', tint: '#7d7a70', rail: 'accent' },
		overrides: {
			'n-50': '#f5f5f2', 'n-100': '#f3f2ee', 'n-200': '#e7e6e1', 'n-300': '#c9c6bc', 'n-400': '#969286',
			'n-500': '#696558', 'n-600': '#545043', 'n-700': '#423e32', 'n-800': '#2a261b', 'n-900': '#1b180e',
			'a-50': '#e8f8ee', 'a-400': '#77a488', 'a-500': '#599170', 'a-600': '#3f7d5a', 'a-700': '#346a4b',
			surface: '#ffffff', rail: '#3f7d5a', 'rail-fg': '#c8d9ce',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
		dark: {
			derived: true,
			inputs: { mode: 'dark', accent: '#3f7d5a', tint: '#7d7a70', rail: 'accent' },
			overrides: {
				'n-50': '#12120f', 'n-100': '#1a1917', 'n-200': '#252421', 'n-300': '#353431', 'n-400': '#6d6c68',
				'n-500': '#8d8c89', 'n-600': '#b1b1af', 'n-700': '#d1d1d0', 'n-800': '#e8e8e7', 'n-900': '#f2f2f1',
				'a-50': '#1a281f', 'a-400': '#8ab79b', 'a-500': '#6fa785', 'a-600': '#5b9573', 'a-700': '#9dc2ab',
				surface: '#1c1c1a', rail: '#183524', 'rail-fg': '#a0ada4',
				...SEMANTIC_DARK, 'on-accent': '#ffffff',
			},
		},
	},
	{
		id: 'ember',
		label: 'Ember',
		hint: 'orange',
		inputs: { mode: 'light', accent: '#d0541c', tint: '#8a7f7a', rail: 'accent' },
		overrides: {
			'n-50': '#f7f4f3', 'n-100': '#f4f1ef', 'n-200': '#eae5e2', 'n-300': '#cdc4bf', 'n-400': '#9b8f8a',
			'n-500': '#6f625d', 'n-600': '#5a4d48', 'n-700': '#483c36', 'n-800': '#2e241f', 'n-900': '#1f1612',
			'a-50': '#ffede4', 'a-400': '#ee8e6a', 'a-500': '#e36f42', 'a-600': '#d0541c', 'a-700': '#b54817',
			surface: '#ffffff', rail: '#d0541c', 'rail-fg': '#f7d1c2',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
		dark: {
			derived: true,
			inputs: { mode: 'dark', accent: '#d0541c', tint: '#8a7f7a', rail: 'accent' },
			overrides: {
				'n-50': '#141110', 'n-100': '#1c1917', 'n-200': '#272322', 'n-300': '#373332', 'n-400': '#6f6b69',
				'n-500': '#8f8b89', 'n-600': '#b3b0af', 'n-700': '#d2d0d0', 'n-800': '#e8e8e7', 'n-900': '#f2f2f1',
				'a-50': '#341d14', 'a-400': '#ee8e6a', 'a-500': '#e57347', 'a-600': '#d35d2d', 'a-700': '#efa184',
				surface: '#1d1b1b', rail: '#511901', 'rail-fg': '#bda299',
				...SEMANTIC_DARK, 'on-accent': '#ffffff',
			},
		},
	},
	{
		id: 'graphite',
		label: 'Graphite',
		hint: 'monochrome',
		inputs: { mode: 'light', accent: '#3a3d46', tint: '#6b7280', rail: 'accent' },
		overrides: {
			'n-50': '#f4f5f7', 'n-100': '#f0f2f4', 'n-200': '#e4e6ea', 'n-300': '#c2c6cd', 'n-400': '#8e929b',
			'n-500': '#61666f', 'n-600': '#4c515a', 'n-700': '#3a3f48', 'n-800': '#22272f', 'n-900': '#151820',
			'a-50': '#f2f3f6', 'a-400': '#61636b', 'a-500': '#4d5058', 'a-600': '#3a3d46', 'a-700': '#2b2e35',
			surface: '#ffffff', rail: '#3a3d46', 'rail-fg': '#c3c4c7',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
		dark: {
			derived: true,
			inputs: { mode: 'dark', accent: '#3a3d46', tint: '#6b7280', rail: 'accent' },
			overrides: {
				'n-50': '#101214', 'n-100': '#18191c', 'n-200': '#232427', 'n-300': '#333437', 'n-400': '#6a6c6f',
				'n-500': '#8a8c8f', 'n-600': '#b0b1b3', 'n-700': '#d0d1d2', 'n-800': '#e7e8e8', 'n-900': '#f1f2f2',
				'a-50': '#232426', 'a-400': '#a8abb3', 'a-500': '#9598a2', 'a-600': '#838690', 'a-700': '#b5b7be',
				surface: '#1b1c1d', rail: '#2c2e32', 'rail-fg': '#a8a9ab',
				...SEMANTIC_DARK, 'on-accent': '#ffffff',
			},
		},
	},
];

export function isPreset(id: string): boolean {
	return PRESETS.some((p) => p.id === id);
}

/** Presets removed when presets became light/dark pairs → their successor, plus the mode a
 *  user on that preset had effectively chosen (only the old Dark preset implies one). */
export const RETIRED_PRESETS: Readonly<Record<string, { id: string; mode?: Mode }>> = {
	default: { id: 'indigo' },
	cool: { id: 'indigo' },
	forest: { id: 'indigo' },
	warm: { id: 'indigo' },
	rose: { id: 'indigo' },
	dark: { id: 'ember', mode: 'dark' },
};
