<script lang="ts">
	import { Pencil, Copy, Trash2, Plus, Check } from 'lucide-svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { resolveTheme, isPreset, type Theme } from '$lib/themes';
	import ThemeEditor from './ThemeEditor.svelte';

	let { active = true }: { active?: boolean } = $props();

	let editing = $state<{ theme: Theme; isNew: boolean } | null>(null);

	const activeTheme = $derived(theme.all.find((t) => t.id === theme.current));
	const activeIsPreset = $derived(isPreset(theme.current));
	const presets = $derived(theme.all.filter((t) => isPreset(t.id)));
	const customs = $derived(theme.all.filter((t) => !isPreset(t.id)));

	const subLabel = 'mb-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-n-500';
	const actionBtn = 'inline-flex h-8.5 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-colors';

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

{#snippet tile(t: Theme)}
	{@const swatch = resolveTheme(t)}
	{@const selected = theme.current === t.id}
	<button
		type="button"
		onclick={() => theme.setTheme(t.id)}
		title={t.label}
		aria-pressed={selected}
		class="h-11 min-w-0 pl-2.5 pr-3 rounded-[10px] flex items-center gap-2.5 text-left text-sm transition-[background-color,box-shadow] {selected
			? 'bg-a-50 text-a-700 font-[650] shadow-[0_0_0_2px_var(--color-a-600)]'
			: 'text-n-700 shadow-[0_0_0_1px_var(--color-n-200)] hover:bg-n-50 hover:shadow-[0_0_0_1px_var(--color-n-300)]'}"
	>
		<span class="flex shrink-0 overflow-hidden rounded-full">
			<span class="block h-6 w-3" style="background:{swatch['n-200']}"></span>
			<span class="block h-6 w-3" style="background:{swatch['a-600']}"></span>
		</span>
		<span class="flex-1 min-w-0 truncate">{t.label}</span>
		{#if selected}
			<Check size={16} strokeWidth={2.5} class="shrink-0" />
		{/if}
	</button>
{/snippet}

<section class:hidden={!active} class="space-y-5">
	<div>
		<h1 class="text-[22px] font-bold tracking-[-0.01em] text-n-900">Appearance</h1>
		<p class="mt-1.5 text-sm text-n-500 text-pretty">
			Pick a theme, or build your own: start from a preset with “Customize”, adjust the accent and
			neutral colors, and fine-tune any step in the advanced view. Custom themes are stored only in
			this browser (included in Backup &amp; Restore).
		</p>
	</div>

	<div class="rounded-xl bg-surface px-8 py-7 shadow-card flex flex-col gap-6 max-md:px-5 max-md:py-5">
		<div>
			<div class={subLabel}>Presets</div>
			<div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
				{#each presets as t (t.id)}
					{@render tile(t)}
				{/each}
			</div>
		</div>

		<div>
			<div class={subLabel}>Your themes</div>
			<div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
				{#each customs as t (t.id)}
					{@render tile(t)}
				{/each}
				<button
					type="button"
					onclick={newTheme}
					class="h-11 px-3 rounded-[10px] flex items-center justify-center gap-1.5 border border-dashed border-n-300 text-sm font-semibold text-a-700 transition-colors hover:bg-n-50 hover:border-n-400"
				>
					<Plus size={15} strokeWidth={2.5} />
					New theme
				</button>
			</div>
		</div>

		<div class="border-t border-n-200 pt-5">
			{#if !editing}
				<div class="flex flex-wrap gap-2.5">
					<button
						type="button"
						onclick={customize}
						class="{actionBtn} text-n-700 shadow-[0_0_0_1px_var(--color-n-300)] hover:bg-n-100"
					>
						<Pencil size={14} />
						{activeIsPreset ? `Customize a copy of ${activeTheme?.label ?? 'this theme'}` : 'Customize'}
					</button>
					<button
						type="button"
						onclick={duplicate}
						class="{actionBtn} text-n-700 shadow-[0_0_0_1px_var(--color-n-300)] hover:bg-n-100"
					>
						<Copy size={14} />
						Duplicate
					</button>
					{#if !activeIsPreset}
						<button
							type="button"
							onclick={remove}
							class="{actionBtn} text-danger shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-danger)_40%,transparent)] hover:bg-danger/8"
						>
							<Trash2 size={14} />
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
		</div>
	</div>
</section>
