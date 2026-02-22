import { storageGetString, storageSet } from '$lib/storage';

const THEME_KEY = 'theme';

const themes = [
	{ id: 'default', label: 'Default', accent: '#ea580c', neutral: '#f1f5f9' },
	{ id: 'warm', label: 'Warm', accent: '#ea580c', neutral: '#e7e5e4' },
	{ id: 'cool', label: 'Cool', accent: '#0891b2', neutral: '#f3f4f6' },
	{ id: 'rose', label: 'Rose', accent: '#e11d48', neutral: '#e4e4e7' },
	{ id: 'forest', label: 'Forest', accent: '#059669', neutral: '#e7e5e4' },
	{ id: 'dark', label: 'Dark', accent: '#ea580c', neutral: '#252830' },
] as const;

type ThemeId = (typeof themes)[number]['id'];

function createTheme() {
	let current = $state<ThemeId>('default');

	function init() {
		const saved = storageGetString(THEME_KEY);
		if (saved && themes.some((t) => t.id === saved)) {
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
		get current() {
			return current;
		},
		get themes() {
			return themes;
		},
		init,
		setTheme,
	};
}

export const theme = createTheme();
