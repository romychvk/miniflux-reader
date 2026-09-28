// App settings (/settings) are split into sections. The section list lives in the sidebar
// (SettingsNav, in place of the feed tree) while the section itself renders in <main>, so the
// active one is shared state rather than page-local.

export type AppSettingsSectionId = 'appearance' | 'ai' | 'backup';

export interface AppSettingsSection {
	id: AppSettingsSectionId;
	label: string;
	hint: string;
	group: 'Reader' | 'Data';
}

export const APP_SETTINGS_SECTIONS: AppSettingsSection[] = [
	{ id: 'appearance', label: 'Appearance', hint: 'Theme & colors', group: 'Reader' },
	{ id: 'ai', label: 'AI Assistant', hint: 'Provider, model, API key', group: 'Reader' },
	{ id: 'backup', label: 'Backup & Restore', hint: 'Export, import, sync status', group: 'Data' }
];

function createAppSettingsStore() {
	let section = $state<AppSettingsSectionId>('appearance');

	return {
		get section() { return section; },
		set section(id: AppSettingsSectionId) { section = id; }
	};
}

export const appSettings = createAppSettingsStore();
