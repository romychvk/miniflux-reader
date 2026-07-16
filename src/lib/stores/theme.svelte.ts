import { storageGet, storageGetString, storageSet } from '$lib/storage';
import { PRESETS, resolveTheme, type Theme, type TokenMap } from '$lib/themes';

const THEME_KEY = 'theme';
const CUSTOM_KEY = 'customThemes';
// Resolved vars of the active theme, applied pre-paint by the app.html script.
const VARS_KEY = 'themeVars';

function createTheme() {
	let current = $state<string>('default');
	let custom = $state<Theme[]>([]);

	const all = $derived<readonly Theme[]>([...PRESETS, ...custom]);

	function find(id: string): Theme | undefined {
		return PRESETS.find((p) => p.id === id) ?? custom.find((c) => c.id === id);
	}

	function applyVars(mode: 'light' | 'dark', vars: TokenMap) {
		const s = document.documentElement.style;
		for (const [k, v] of Object.entries(vars)) s.setProperty('--' + k, v);
		// Native scrollbars / form controls follow the theme
		s.colorScheme = mode;
	}

	function applyCurrent() {
		const t = find(current) ?? PRESETS[0];
		const vars = resolveTheme(t);
		applyVars(t.inputs.mode, vars);
		storageSet(VARS_KEY, { mode: t.inputs.mode, vars });
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
		for (const t of custom) t.overrides ??= {};

		const saved = storageGetString(THEME_KEY);
		current = saved && find(saved) ? saved : 'default';
		// Also heals a stale/missing themeVars (e.g. right after a settings import)
		applyCurrent();
	}

	function setTheme(id: string) {
		if (!find(id)) return;
		current = id;
		storageSet(THEME_KEY, id);
		applyCurrent();
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
		if (current === id) setTheme('default');
	}

	/** Editor live preview — applies vars without persisting anything. */
	function preview(mode: 'light' | 'dark', vars: TokenMap) {
		applyVars(mode, vars);
	}

	/** Restore the persisted current theme after a cancelled/finished preview. */
	function endPreview() {
		// No fallback here: if the current id can't be resolved (transient state
		// during a save), keeping the previewed vars beats flashing the default.
		const t = find(current);
		if (t) applyVars(t.inputs.mode, resolveTheme(t));
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
		init,
		setTheme,
		saveCustom,
		deleteCustom,
		preview,
		endPreview,
		newId,
	};
}

export const theme = createTheme();
