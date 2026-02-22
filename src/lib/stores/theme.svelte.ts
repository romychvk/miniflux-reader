import { storageGetString, storageSet } from '$lib/storage';

const THEME_KEY = 'theme';

const themes = [
	{ id: 'default', label: 'Default' },
	{ id: 'warm', label: 'Warm' },
	{ id: 'cool', label: 'Cool' },
	{ id: 'rose', label: 'Rose' },
] as const;

type ThemeId = (typeof themes)[number]['id'];

function createTheme() {
	let current = $state<ThemeId>('default');

	function init() {
		const saved = storageGetString(THEME_KEY);
		if (saved && themes.some(t => t.id === saved)) {
			current = saved as ThemeId;
		}
		applyTheme(current);
	}

	function setTheme(id: ThemeId) {
		current = id;
		storageSet(THEME_KEY, id);
		applyTheme(id);
	}

	function applyTheme(id: ThemeId) {
		if (id === 'default') {
			document.documentElement.removeAttribute('data-theme');
		} else {
			document.documentElement.setAttribute('data-theme', id);
		}
	}

	return {
		get current() { return current; },
		get themes() { return themes; },
		init,
		setTheme,
	};
}

export const theme = createTheme();
