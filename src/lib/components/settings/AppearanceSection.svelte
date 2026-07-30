<script lang="ts">
	import { Pencil, Copy, Trash2, Plus } from 'lucide-svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { resolveTheme, isPreset, type Theme } from '$lib/themes';
	import ThemeEditor from './ThemeEditor.svelte';

	let { active = true }: { active?: boolean } = $props();

	let editing = $state<{ theme: Theme; isNew: boolean } | null>(null);

	const activeTheme = $derived(theme.all.find((t) => t.id === theme.current));
	const activeIsPreset = $derived(isPreset(theme.current));

	function copyOf(t: Theme, label: string): Theme {
		return {
			...JSON.parse(JSON.stringify($state.snapshot(t))),
			id: theme.newId(),
			label,
		};
	}

	function customize() {
		if (!activeTheme) return;
		// Presets are read-only — customizing one opens an unsaved copy instead.
		editing = activeIsPreset
			? { theme: copyOf(activeTheme, `${activeTheme.label} copy`), isNew: true }
			: { theme: $state.snapshot(activeTheme), isNew: false };
	}

	function duplicate() {
		if (!activeTheme) return;
		editing = { theme: copyOf(activeTheme, `${activeTheme.label} copy`), isNew: true };
	}

	function remove() {
		if (!activeTheme || activeIsPreset) return;
		if (!confirm(`Delete the “${activeTheme.label}” theme?`)) return;
		editing = null;
		theme.deleteCustom(activeTheme.id);
	}

	function newTheme() {
		editing = {
			theme: {
				id: theme.newId(),
				label: 'My theme',
				inputs: { mode: 'light', accent: '#2563eb', tint: '#64748b' },
				overrides: {},
			},
			isNew: true,
		};
	}

	function handleSave(t: Theme) {
		theme.saveCustom(t);
		theme.setTheme(t.id);
		editing = null;
	}
</script>

<section class:hidden={!active} class="rounded-lg border border-n-100 bg-surface p-5 shadow-xl">
	<h3 class="mb-1 text-sm font-semibold uppercase tracking-wide text-n-500">Appearance</h3>
	<p class="mb-4 text-sm text-n-500">
		Pick a theme, or build your own: start from a preset with “Customize”, adjust the accent and
		neutral colors, and fine-tune any step in the advanced view. Custom themes are stored only in
		this browser (included in Backup &amp; Restore).
	</p>

	<div class="flex flex-wrap gap-x-5 gap-y-3">
		{#each theme.all as t (t.id)}
			{@const swatch = resolveTheme(t)}
			<button
				type="button"
				onclick={() => theme.setTheme(t.id)}
				title={t.label}
				class="flex items-center gap-2 rounded-full text-sm text-n-700 hover:outline-n-400 hover:outline-2 {theme.current === t.id ? 'font-bold outline-a-600 outline-2' : ''}"
			>
				<span class="flex overflow-hidden rounded-full border border-n-200">
					<span class="block h-8 w-4" style="background:{swatch['n-200']}"></span>
					<span class="block h-8 w-4" style="background:{swatch['a-600']}"></span>
				</span>
				<span class="pr-2">{t.label}</span>
			</button>
		{/each}
	</div>

	{#if !editing}
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<button
				type="button"
				onclick={customize}
				class="inline-flex items-center gap-1.5 rounded-md border border-n-300 px-3 py-1.5 text-sm text-n-700 hover:bg-n-100"
			>
				<Pencil class="h-3.5 w-3.5" />
				{activeIsPreset ? 'Customize a copy' : 'Customize'}
			</button>
			<button
				type="button"
				onclick={duplicate}
				class="inline-flex items-center gap-1.5 rounded-md border border-n-300 px-3 py-1.5 text-sm text-n-700 hover:bg-n-100"
			>
				<Copy class="h-3.5 w-3.5" />
				Duplicate
			</button>
			<button
				type="button"
				onclick={newTheme}
				class="inline-flex items-center gap-1.5 rounded-md border border-n-300 px-3 py-1.5 text-sm text-n-700 hover:bg-n-100"
			>
				<Plus class="h-3.5 w-3.5" />
				New theme
			</button>
			{#if !activeIsPreset}
				<button
					type="button"
					onclick={remove}
					class="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
				>
					<Trash2 class="h-3.5 w-3.5" />
					Delete
				</button>
			{/if}
		</div>
	{:else}
		{#key editing.theme.id}
			<ThemeEditor
				editTheme={editing.theme}
				isNew={editing.isNew}
				onsave={handleSave}
				oncancel={() => (editing = null)}
			/>
		{/key}
	{/if}
</section>
