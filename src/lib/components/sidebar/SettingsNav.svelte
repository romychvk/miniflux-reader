<script lang="ts">
	import { ArrowLeft } from 'lucide-svelte';
	import { appSettings, APP_SETTINGS_SECTIONS, APP_SETTINGS_ICONS as icons } from '$lib/stores/appSettings.svelte';
	import { settingsSync } from '$lib/settingsSync.svelte';

	// Stands in for the feed tree while /settings is open — same column, same width, so nothing
	// shifts between the reader and settings.

	const groups = [...new Set(APP_SETTINGS_SECTIONS.map((s) => s.group))];
</script>

<div class="h-13 shrink-0 px-2.5 flex items-center gap-1.5">
	<button
		type="button"
		onclick={() => history.back()}
		title="Back"
		aria-label="Back"
		class="size-8 grid place-items-center rounded-lg text-sb-600 transition-colors hover:bg-sb-200/60 hover:text-sb-900"
	>
		<ArrowLeft size={18} strokeWidth={2} />
	</button>
	<h2 class="text-[15px] font-bold tracking-[-0.01em] text-sb-900">Settings</h2>
</div>

<nav class="scroll-quiet flex-1 flex flex-col gap-0.5 px-2 pt-0.5 pb-2">
	{#each groups as group, gi (group)}
		<div class="px-2.5 {gi === 0 ? 'pt-1.5' : 'pt-3'} pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sb-500">
			{group}
		</div>
		{#each APP_SETTINGS_SECTIONS.filter((s) => s.group === group) as item (item.id)}
			{@const Icon = icons[item.id]}
			{@const active = appSettings.section === item.id}
			<button
				type="button"
				onclick={() => (appSettings.section = item.id)}
				aria-current={active ? 'page' : undefined}
				class="h-12 shrink-0 px-2.5 rounded-lg flex items-center gap-2.5 text-left transition-colors {active
					? 'bg-a-600/12 text-a-700'
					: 'text-sb-700 hover:bg-sb-200/60'}"
			>
				<Icon size={16} class="shrink-0 {active ? 'text-a-700' : 'text-sb-500'}" />
				<span class="min-w-0">
					<span class="block truncate text-[13.5px] {active ? 'font-[650]' : 'font-[450]'}">{item.label}</span>
					<span class="block truncate text-[11.5px] text-sb-500">{item.hint}</span>
				</span>
			</button>
		{/each}
	{/each}
</nav>

<div class="shrink-0 border-t border-sb-200 px-4.5 py-3 text-[11.5px] text-sb-500">
	{#if settingsSync.syncError}
		<span class="text-danger">Sync failed — kept in this browser</span>
	{:else if settingsSync.lastSyncAt}
		Synced with server at {new Date(settingsSync.lastSyncAt).toLocaleTimeString()}
	{:else}
		Not synced yet in this session
	{/if}
</div>
