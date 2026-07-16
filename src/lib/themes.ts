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
 */

import { hexToOklch, oklchToHex } from '$lib/color';

export const TOKENS = [
	'n-50', 'n-100', 'n-200', 'n-300', 'n-400', 'n-500', 'n-600', 'n-700', 'n-800', 'n-900',
	'a-50', 'a-400', 'a-500', 'a-600', 'a-700',
	'surface',
	'danger', 'danger-strong', 'success', 'warning', 'overlay', 'on-accent',
	'sidebar', 'navbar',
] as const;

export type Token = (typeof TOKENS)[number];
export type TokenMap = Record<Token, string>; // hex values

export interface ThemeInputs {
	mode: 'light' | 'dark';
	/** Accent base color — becomes the a-600 step */
	accent: string;
	/** Neutral tint — hue/chroma source for the n-* ramp and dark surfaces */
	tint: string;
}

export interface Theme {
	id: string;
	label: string;
	inputs: ThemeInputs;
	overrides: Partial<TokenMap>;
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
	const key = `${inputs.mode}|${inputs.accent}|${inputs.tint}`;
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
	// Sidebar / navbar chrome follows the surface unless explicitly overridden
	map.sidebar = map.surface;
	map.navbar = map.surface;

	Object.assign(map, dark ? SEMANTIC_DARK : SEMANTIC_LIGHT);
	// Light accents (yellow, lime) need dark label text; the darkest neutral
	// is n-900 on light themes and n-50 on dark ones (the ramp is inverted).
	map['on-accent'] = al < 0.7 ? '#ffffff' : map[dark ? 'n-50' : 'n-900'];

	genCache.set(key, map);
	return map;
}

export function resolveTheme(t: Theme): TokenMap {
	const map = { ...generateTokens(t.inputs), ...t.overrides };
	// Keep sidebar/navbar glued to the (possibly overridden) surface unless the
	// theme overrides them explicitly — presets and pre-existing custom themes
	// carry no sidebar/navbar overrides and must keep looking as before.
	if (!('sidebar' in t.overrides)) map.sidebar = map.surface;
	if (!('navbar' in t.overrides)) map.navbar = map.surface;
	return map;
}

// Hand-tuned Tailwind ramps, transcribed verbatim from the pre-token app.css
// so presets render pixel-identically. The default accent was authored as
// oklch() — these hexes are the exact Tailwind blue equivalents.
export const PRESETS: readonly Theme[] = [
	{
		id: 'default',
		label: 'Default',
		inputs: { mode: 'light', accent: '#2563eb', tint: '#64748b' },
		overrides: {
			'n-50': '#f8fafc', 'n-100': '#f1f5f9', 'n-200': '#e2e8f0', 'n-300': '#cbd5e1',
			'n-400': '#94a3b8', 'n-500': '#64748b', 'n-600': '#475569', 'n-700': '#334155',
			'n-800': '#1e293b', 'n-900': '#0f172a',
			'a-50': '#eff6ff', 'a-400': '#60a5fa', 'a-500': '#3b82f6', 'a-600': '#2563eb', 'a-700': '#1d4ed8',
			surface: '#ffffff',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
	},
	{
		id: 'cool',
		label: 'Cool',
		inputs: { mode: 'light', accent: '#0891b2', tint: '#6b7280' },
		overrides: {
			'n-50': '#f9fafb', 'n-100': '#f3f4f6', 'n-200': '#e5e7eb', 'n-300': '#d1d5db',
			'n-400': '#9ca3af', 'n-500': '#6b7280', 'n-600': '#4b5563', 'n-700': '#374151',
			'n-800': '#1f2937', 'n-900': '#111827',
			'a-50': '#ecfeff', 'a-400': '#22d3ee', 'a-500': '#06b6d4', 'a-600': '#0891b2', 'a-700': '#0e7490',
			surface: '#ffffff',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
	},
	{
		id: 'forest',
		label: 'Forest',
		inputs: { mode: 'light', accent: '#059669', tint: '#78716c' },
		overrides: {
			'n-50': '#fafaf9', 'n-100': '#f5f5f4', 'n-200': '#e7e5e4', 'n-300': '#d6d3d1',
			'n-400': '#a8a29e', 'n-500': '#78716c', 'n-600': '#57534e', 'n-700': '#44403c',
			'n-800': '#292524', 'n-900': '#1c1917',
			'a-50': '#ecfdf5', 'a-400': '#34d399', 'a-500': '#10b981', 'a-600': '#059669', 'a-700': '#047857',
			surface: '#ffffff',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
	},
	{
		id: 'warm',
		label: 'Warm',
		inputs: { mode: 'light', accent: '#ea580c', tint: '#78716c' },
		overrides: {
			'n-50': '#fafaf9', 'n-100': '#f5f5f4', 'n-200': '#e7e5e4', 'n-300': '#d6d3d1',
			'n-400': '#a8a29e', 'n-500': '#78716c', 'n-600': '#57534e', 'n-700': '#44403c',
			'n-800': '#292524', 'n-900': '#1c1917',
			'a-50': '#fff7ed', 'a-400': '#fb923c', 'a-500': '#f97316', 'a-600': '#ea580c', 'a-700': '#c2410c',
			surface: '#ffffff',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
	},
	{
		id: 'rose',
		label: 'Rose',
		inputs: { mode: 'light', accent: '#e11d48', tint: '#71717a' },
		overrides: {
			'n-50': '#fafafa', 'n-100': '#f4f4f5', 'n-200': '#e4e4e7', 'n-300': '#d4d4d8',
			'n-400': '#a1a1aa', 'n-500': '#71717a', 'n-600': '#52525b', 'n-700': '#3f3f46',
			'n-800': '#27272a', 'n-900': '#18181b',
			'a-50': '#fff1f2', 'a-400': '#fb7185', 'a-500': '#f43f5e', 'a-600': '#e11d48', 'a-700': '#be123c',
			surface: '#ffffff',
			...SEMANTIC_LIGHT, 'on-accent': '#ffffff',
		},
	},
	{
		id: 'dark',
		label: 'Dark',
		inputs: { mode: 'dark', accent: '#ea580c', tint: '#8b90a0' },
		overrides: {
			'n-50': '#0f1117', 'n-100': '#181b23', 'n-200': '#252830', 'n-300': '#353840',
			'n-400': '#6b7080', 'n-500': '#8b90a0', 'n-600': '#b0b5c3', 'n-700': '#d0d4de',
			'n-800': '#e8eaf0', 'n-900': '#f3f4f7',
			'a-50': '#1c1410', 'a-400': '#fb923c', 'a-500': '#f97316', 'a-600': '#ea580c', 'a-700': '#fdba74',
			surface: '#1a1d25',
			...SEMANTIC_DARK, 'on-accent': '#ffffff',
		},
	},
];

export function isPreset(id: string): boolean {
	return PRESETS.some((p) => p.id === id);
}
