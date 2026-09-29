import { storageGet, storageGetString, storageSet } from '$lib/storage';
import {
	PRESETS,
	RETIRED_PRESETS,
	resolveThemeCss,
	variantFor,
	type Mode,
	type ModePref,
	type Theme,
} from '$lib/themes';

const THEME_KEY = 'theme';
const MODE_KEY = 'themeMode';
const CUSTOM_KEY = 'customThemes';
// Resolved vars of the active theme, applied pre-paint by the app.html script:
// { mode, vars } for the variant showing now, plus — when a paired theme follows the
// system — `sys: { light, dark }` so the script can pick by prefers-color-scheme itself.
const VARS_KEY = 'themeVars';
const DEFAULT_ID = 'indigo';

const isModePref = (v: unknown): v is ModePref => v === 'light' || v === 'dark' || v === 'system';

function createTheme() {
	let current = $state<string>(DEFAULT_ID);
	let custom = $state<Theme[]>([]);
	let modePref = $state<ModePref>('system');
	let systemDark = $state(false);

	const all = $derived<readonly Theme[]>([...PRESETS, ...custom]);
	const effectiveMode = $derived<Mode>(modePref === 'system' ? (systemDark ? 'dark' : 'light') : modePref);

	function find(id: string): Theme | undefined {
		return PRESETS.find((p) => p.id === id) ?? custom.find((c) => c.id === id);
	}

	function applyVars(mode: Mode, vars: Record<string, string>) {
		const s = document.documentElement.style;
		for (const [k, v] of Object.entries(vars)) s.setProperty('--' + k, v);
		// Native scrollbars / form controls follow the theme
		s.colorScheme = mode;
	}

	function payload(t: Theme, mode: Mode) {
		const v = variantFor(t, mode);
		return { mode: v.inputs.mode, vars: resolveThemeCss(v) };
	}

	function applyCurrent() {
		const t = find(current) ?? PRESETS[0];
		const now = payload(t, effectiveMode);
		applyVars(now.mode, now.vars);
		storageSet(
			VARS_KEY,
			modePref === 'system' && t.dark
				? { ...now, sys: { light: payload(t, 'light'), dark: payload(t, 'dark') } }
				: now
		);
	}

	function init() {
		custom = storageGet<Theme[]>(CUSTOM_KEY, []).filter(
			(t) =>
				t &&
				typeof t.id === 'string' &&
				typeof t.label === 'string' &&
				t.inputs &&
				(t.inputs.mode === 'light' || t.inputs.mode === 'dark')
		);
		for (const t of custom) {
			t.overrides ??= {};
			if (t.dark) t.dark.overrides ??= {};
		}

		const savedMode = storageGetString(MODE_KEY);
		modePref = isModePref(savedMode) ? savedMode : 'system';

		let saved = storageGetString(THEME_KEY);
		// Presets that became light/dark pairs: move to the successor palette (the old Dark
		// preset also meant "dark mode", unless a mode was chosen since).
		const retired = saved ? RETIRED_PRESETS[saved] : undefined;
		if (retired && !find(saved!)) {
			saved = retired.id;
			storageSet(THEME_KEY, saved);
			if (retired.mode && !isModePref(savedMode)) {
				modePref = retired.mode;
				storageSet(MODE_KEY, modePref);
			}
		}
		current = saved && find(saved) ? saved : DEFAULT_ID;

		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		systemDark = mq.matches;
		mq.addEventListener('change', (e) => {
			systemDark = e.matches;
			if (modePref === 'system') applyCurrent();
		});

		// Also heals a stale/missing themeVars (e.g. right after a settings import)
		applyCurrent();
	}

	function setTheme(id: string) {
		if (!find(id)) return;
		current = id;
		storageSet(THEME_KEY, id);
		applyCurrent();
	}

	function setMode(pref: ModePref) {
		modePref = pref;
		storageSet(MODE_KEY, pref);
		applyCurrent();
	}

	/** Rail button: every click flips what is on screen. Landing on what the OS shows anyway
	 *  means "system" — a plain light → dark → system cycle had a click that changed nothing
	 *  (system and light look the same on a light OS). */
	function toggleMode() {
		const next: Mode = effectiveMode === 'dark' ? 'light' : 'dark';
		setMode(next === (systemDark ? 'dark' : 'light') ? 'system' : next);
	}

	function persistCustom() {
		storageSet(CUSTOM_KEY, $state.snapshot(custom));
	}

	function saveCustom(t: Theme) {
		const i = custom.findIndex((c) => c.id === t.id);
		if (i >= 0) custom[i] = t;
		else custom.push(t);
		persistCustom();
		if (current === t.id) applyCurrent();
	}

	function deleteCustom(id: string) {
		custom = custom.filter((c) => c.id !== id);
		persistCustom();
		if (current === id) setTheme(DEFAULT_ID);
	}

	/** Editor live preview — applies the variant of a draft theme that matches the current
	 *  mode, without persisting anything. */
	function preview(t: Theme) {
		const p = payload(t, effectiveMode);
		applyVars(p.mode, p.vars);
	}

	/** Restore the persisted current theme after a cancelled/finished preview. */
	function endPreview() {
		// No fallback here: if the current id can't be resolved (transient state
		// during a save), keeping the previewed vars beats flashing the default.
		const t = find(current);
		if (t) {
			const p = payload(t, effectiveMode);
			applyVars(p.mode, p.vars);
		}
	}

	function newId(): string {
		return `custom-${Date.now().toString(36)}`;
	}

	return {
		get current() {
			return current;
		},
		get presets() {
			return PRESETS;
		},
		get custom() {
			return custom;
		},
		get all() {
			return all;
		},
		get modePref() {
			return modePref;
		},
		/** light / dark after resolving `system` against the OS setting. */
		get effectiveMode() {
			return effectiveMode;
		},
		init,
		setTheme,
		setMode,
		toggleMode,
		saveCustom,
		deleteCustom,
		preview,
		endPreview,
		newId,
	};
}

export const theme = createTheme();
