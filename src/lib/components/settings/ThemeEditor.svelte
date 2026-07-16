<script lang="ts">
	import { theme } from '$lib/stores/theme.svelte';
	import { resolveTheme, generateTokens, TOKENS, type Theme, type Token } from '$lib/themes';

	let { editTheme, isNew, onsave, oncancel }: {
		editTheme: Theme;
		isNew: boolean;
		onsave: (t: Theme) => void;
		oncancel: () => void;
	} = $props();

	// Local draft — deep copy so edits never touch the stored theme until Save.
	// svelte-ignore state_referenced_locally
	let draft = $state<Theme>(JSON.parse(JSON.stringify(editTheme)));
	let showAdvanced = $state(false);
	let error = $state('');

	const resolved = $derived(resolveTheme(draft));
	const generated = $derived(generateTokens(draft.inputs));
	const hasOverrides = $derived(Object.keys(draft.overrides).length > 0);

	// Quick hue chips for the neutral tint (Tailwind slate / gray / zinc / stone 500)
	const TINT_CHIPS = [
		{ label: 'Slate', hex: '#64748b' },
		{ label: 'Gray', hex: '#6b7280' },
		{ label: 'Zinc', hex: '#71717a' },
		{ label: 'Stone', hex: '#78716c' },
	];

	const NEUTRAL_TOKENS = TOKENS.slice(0, 10);
	const ACCENT_TOKENS = TOKENS.slice(10, 15);
	const OTHER_TOKENS = TOKENS.slice(15);

	// Live preview: every draft change restyles the whole app; leaving the
	// editor (cancel, save, navigation) restores the persisted theme.
	$effect(() => {
		theme.preview(draft.inputs.mode, resolved);
	});
	$effect(() => {
		// queueMicrotask escapes the teardown's reactive context: state reads
		// inside an effect teardown see the values from the effect's previous
		// run (here: from mount), which would restore the WRONG theme after
		// a save. A microtask reads live state instead.
		return () => queueMicrotask(() => theme.endPreview());
	});

	// Simple-mode inputs regenerate the ramps, so advanced tweaks are dropped —
	// otherwise a duplicated preset (all 22 tokens pinned) would never change.
	function setSimple<K extends keyof Theme['inputs']>(key: K, value: Theme['inputs'][K]) {
		draft.inputs[key] = value;
		draft.overrides = {};
	}

	function setOverride(token: Token, value: string) {
		if (!/^#[0-9a-f]{6}$/i.test(value)) return;
		if (value.toLowerCase() === generated[token].toLowerCase()) delete draft.overrides[token];
		else draft.overrides[token] = value.toLowerCase();
	}

	function resetOverride(token: Token) {
		delete draft.overrides[token];
	}

	function save() {
		const label = draft.label.trim();
		if (!label) {
			error = 'Give the theme a name.';
			return;
		}
		const clash = theme.all.some(
			(t) => t.id !== draft.id && t.label.trim().toLowerCase() === label.toLowerCase()
		);
		if (clash) {
			error = `A theme named “${label}” already exists.`;
			return;
		}
		draft.label = label;
		onsave($state.snapshot(draft));
	}
</script>

<div class="mt-4 rounded-md border border-n-200 bg-n-50 p-4 space-y-4">
	<div class="flex flex-wrap items-end gap-4">
		<div>
			<label for="theme-name" class="block text-sm font-medium text-n-700 mb-1">Name</label>
			<input
				id="theme-name"
				type="text"
				bind:value={draft.label}
				oninput={() => (error = '')}
				class="w-44 rounded-md border border-n-300 bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
			/>
		</div>

		<div>
			<span class="block text-sm font-medium text-n-700 mb-1">Mode</span>
			<div class="inline-flex overflow-hidden rounded-md border border-n-300">
				{#each ['light', 'dark'] as const as mode, i (mode)}
					<button
						type="button"
						onclick={() => setSimple('mode', mode)}
						aria-pressed={draft.inputs.mode === mode}
						class="px-3 py-1.5 text-sm capitalize {i > 0 ? 'border-l border-n-300' : ''} {draft.inputs.mode === mode
							? 'bg-a-600 text-on-accent'
							: 'bg-surface text-n-700 hover:bg-n-100'}"
					>
						{mode}
					</button>
				{/each}
			</div>
		</div>

		<div>
			<label for="theme-accent" class="block text-sm font-medium text-n-700 mb-1">Accent</label>
			<input
				id="theme-accent"
				type="color"
				value={draft.inputs.accent}
				oninput={(e) => setSimple('accent', e.currentTarget.value)}
				class="h-8 w-14 cursor-pointer rounded border border-n-300 bg-surface"
			/>
		</div>

		<div>
			<label for="theme-tint" class="block text-sm font-medium text-n-700 mb-1">Neutral tint</label>
			<div class="flex items-center gap-2">
				<input
					id="theme-tint"
					type="color"
					value={draft.inputs.tint}
					oninput={(e) => setSimple('tint', e.currentTarget.value)}
					class="h-8 w-14 cursor-pointer rounded border border-n-300 bg-surface"
				/>
				{#each TINT_CHIPS as chip (chip.hex)}
					<button
						type="button"
						title={chip.label}
						onclick={() => setSimple('tint', chip.hex)}
						class="h-6 w-6 rounded-full border border-n-300 {draft.inputs.tint === chip.hex ? 'outline-2 outline-a-600' : ''}"
						style="background:{chip.hex}"
					></button>
				{/each}
			</div>
		</div>
	</div>

	<!-- Ramp preview -->
	<div class="space-y-2">
		<div class="flex overflow-hidden rounded-md border border-n-200">
			{#each NEUTRAL_TOKENS as t (t)}
				<span class="h-6 flex-1" title="{t} {resolved[t]}" style="background:{resolved[t]}"></span>
			{/each}
		</div>
		<div class="flex items-center gap-2">
			<span class="flex flex-1 overflow-hidden rounded-md border border-n-200">
				{#each ACCENT_TOKENS as t (t)}
					<span class="h-6 flex-1" title="{t} {resolved[t]}" style="background:{resolved[t]}"></span>
				{/each}
			</span>
			{#each OTHER_TOKENS as t (t)}
				<span
					class="h-6 w-6 shrink-0 rounded-full border border-n-200"
					title="{t} {resolved[t]}"
					style="background:{resolved[t]}"
				></span>
			{/each}
		</div>
	</div>

	<div>
		<button
			type="button"
			onclick={() => (showAdvanced = !showAdvanced)}
			class="text-sm text-a-600 underline hover:text-a-700"
		>
			{showAdvanced ? 'Hide advanced' : 'Advanced: edit individual colors'}
		</button>
		{#if hasOverrides}
			<span class="ml-2 text-xs text-n-500">
				Has manual tweaks — changing Mode/Accent/Tint resets them.
			</span>
		{/if}
	</div>

	{#if showAdvanced}
		<div class="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
			{#each TOKENS as t (t)}
				<div class="flex items-center gap-2">
					<input
						type="color"
						value={resolved[t]}
						oninput={(e) => setOverride(t, e.currentTarget.value)}
						class="h-6 w-9 shrink-0 cursor-pointer rounded border border-n-300 bg-surface"
					/>
					<span class="flex-1 truncate font-mono text-xs text-n-600">{t}</span>
					{#if t in draft.overrides}
						<button
							type="button"
							title="Reset to generated"
							onclick={() => resetOverride(t)}
							class="text-xs text-n-500 hover:text-n-700"
						>
							↺
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if error}
		<p class="text-sm text-danger">{error}</p>
	{/if}

	<div class="flex justify-end gap-2 border-t border-n-200 pt-3">
		<button
			type="button"
			onclick={oncancel}
			class="rounded-md px-4 py-2 text-sm text-n-600 hover:bg-n-100"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={save}
			class="rounded-md bg-a-600 px-4 py-2 text-sm text-on-accent hover:bg-a-700"
		>
			{isNew ? 'Create theme' : 'Save changes'}
		</button>
	</div>
</div>
