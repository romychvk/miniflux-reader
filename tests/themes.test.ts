import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	PRESETS,
	RETIRED_PRESETS,
	generatePairedDark,
	generateTokens,
	pinTokens,
	resolveTheme,
	resolveThemeCss,
	tweaksOver,
	variantFor,
	type Theme,
} from '../src/lib/themes.ts';
import { hexToOklch } from '../src/lib/color.ts';

function oklabDist(a: string, b: string): number {
	const x = hexToOklch(a);
	const y = hexToOklch(b);
	const r = Math.PI / 180;
	return Math.hypot(
		x.l - y.l,
		x.c * Math.cos(x.h * r) - y.c * Math.cos(y.h * r),
		x.c * Math.sin(x.h * r) - y.c * Math.sin(y.h * r)
	);
}

test('every preset is a light/dark pair with all color tokens pinned', () => {
	assert.equal(PRESETS.length, 7);
	for (const p of PRESETS) {
		assert.equal(p.inputs.mode, 'light', p.id);
		assert.equal(p.dark?.inputs.mode, 'dark', p.id);
		for (const v of [p, p.dark!]) {
			for (const k of ['n-50', 'n-900', 'a-600', 'surface', 'rail', 'rail-fg', 'on-accent'] as const)
				assert.ok(v.overrides[k], `${p.id} ${v.inputs.mode} ${k}`);
			// Pinning a zone token would mark the sidebar / navbar as customized.
			assert.ok(!('sidebar' in v.overrides) && !('navbar' in v.overrides), p.id);
		}
	}
});

test('rail states derive to the handed-off values (accent tile on dark and on neutral rails)', () => {
	const indigo = PRESETS.find((p) => p.id === 'indigo')!;
	const light = PRESETS.find((p) => p.id === 'light')!;
	assert.deepEqual(pick(resolveThemeCss(indigo)), ['#ffffff', '#3438a8', '#ffffff']);
	assert.deepEqual(pick(resolveThemeCss(indigo.dark!)), ['#697ae9', '#ffffff', '#ffffff']);
	assert.deepEqual(pick(resolveThemeCss(light)), ['#1c6fd4', '#ffffff', '#15181f']);
	function pick(v: Record<string, string>) {
		return [v['rail-active'], v['rail-active-fg'], v['rail-strong']];
	}
});

test('"Derive from light" reproduces the presets\' dark variants', () => {
	for (const p of PRESETS) {
		const g = generatePairedDark(p.inputs);
		for (const [k, v] of Object.entries(p.dark!.overrides)) {
			// Sepia's accent was lifted by hand a little further than the generator does.
			const tol = p.id === 'sepia' && k.startsWith('a-') ? 0.05 : 0.012;
			assert.ok(oklabDist(g[k as keyof typeof g], v) < tol, `${p.id} ${k}: ${g[k as keyof typeof g]} vs ${v}`);
		}
	}
});

test('the rail input picks accent, neutral or a custom color', () => {
	const base = { mode: 'light' as const, accent: '#3438a8', tint: '#8e90a8' };
	assert.equal(generateTokens({ ...base, rail: 'accent' }).rail, '#3438a8');
	assert.equal(generateTokens({ ...base, rail: '#123456' }).rail, '#123456');
	assert.ok(hexToOklch(generateTokens({ ...base, rail: 'neutral' }).rail).l > 0.9);
	assert.ok(hexToOklch(generatePairedDark({ ...base, rail: 'neutral' }).rail).l < 0.2);
	// Pre-pairing single-mode dark themes keep their rail on the page background.
	const legacyDark = generateTokens({ ...base, mode: 'dark' });
	assert.equal(legacyDark.rail, legacyDark['n-50']);
});

test('variantFor: paired themes follow the mode, single-mode ones never switch', () => {
	const indigo = PRESETS.find((p) => p.id === 'indigo')!;
	assert.equal(variantFor(indigo, 'light'), indigo);
	assert.equal(variantFor(indigo, 'dark'), indigo.dark);
	const lightOnly: Theme = { id: 'c', label: 'c', inputs: { ...indigo.inputs }, overrides: {} };
	assert.equal(variantFor(lightOnly, 'dark'), lightOnly);
});

test('a stored derived dark variant (pinned tokens) renders exactly as generated', () => {
	const inputs = { mode: 'dark' as const, accent: '#0a7d4f', tint: '#6b7280', rail: 'accent' };
	const g = generatePairedDark(inputs);
	const r = resolveTheme({ inputs, overrides: pinTokens(g) });
	for (const k of ['n-50', 'n-900', 'a-600', 'a-700', 'surface', 'rail', 'rail-fg', 'sidebar'] as const)
		assert.equal(r[k], g[k], k);
	assert.deepEqual(tweaksOver(pinTokens(g), g), {});
	assert.deepEqual(tweaksOver({ ...pinTokens(g), 'a-600': '#ff0000' }, g), { 'a-600': '#ff0000' });
});

test('retired presets map onto current ones', () => {
	for (const { id } of Object.values(RETIRED_PRESETS)) assert.ok(PRESETS.some((p) => p.id === id), id);
	assert.equal(RETIRED_PRESETS.dark.mode, 'dark');
});
