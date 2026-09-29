<script lang="ts">
	import { Check, Moon, Sun } from 'lucide-svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import {
		generatePairedDark,
		generateTokens,
		pinTokens,
		resolveTheme,
		resolveThemeCss,
		tweaksOver,
		TOKENS,
		type DarkVariant,
		type RailInput,
		type Theme,
		type ThemeInputs,
		type ThemeVariant,
		type Token,
		type TokenMap,
	} from '$lib/themes';
	import ThemeMiniature from './ThemeMiniature.svelte';

	let { editTheme, isNew, onsave, oncancel }: {
		editTheme: Theme;
		isNew: boolean;
		onsave: (t: Theme) => void;
		oncancel: () => void;
	} = $props();

	// Deep copy so edits never touch the stored theme until Save.
	// svelte-ignore state_referenced_locally
	const src: Theme = JSON.parse(JSON.stringify(editTheme));

	let label = $state(src.label);
	// The theme's own variant: the light one of a paired theme, the only one of a single-mode
	// theme (saved before pairing existed — it may be dark).
	let main = $state<ThemeVariant>({ inputs: src.inputs, overrides: src.overrides ?? {} });
	let paired = $state(!!src.dark);
	// Dark variant: generated from `main` while derived; otherwise its own seeds plus tweaks
	// over what those seeds generate.
	let darkDerived = $state(src.dark?.derived === true);
	let darkInputs = $state<ThemeInputs>(src.dark ? src.dark.inputs : { ...src.inputs, mode: 'dark' });
	let darkTweaks = $state<Partial<TokenMap>>(
		src.dark ? tweaksOver(src.dark.overrides ?? {}, generatePairedDark(src.dark.inputs)) : {}
	);

	let advancedMain = $state(false);
	let advancedDark = $state(false);
	let error = $state('');

	const mainMode = $derived(main.inputs.mode);
	const mainGenerated = $derived(generateTokens(main.inputs));
	const mainResolved = $derived(resolveTheme(main));

	const darkSeeds = $derived<ThemeInputs>(darkDerived ? { ...main.inputs, mode: 'dark' } : darkInputs);
	const darkBase = $derived(generatePairedDark(darkSeeds));
	const darkVariant = $derived<DarkVariant | undefined>(
		paired
			? {
					inputs: darkSeeds,
					overrides: { ...pinTokens(darkBase), ...(darkDerived ? {} : darkTweaks) },
					derived: darkDerived,
				}
			: undefined
	);
	const darkResolved = $derived(darkVariant ? resolveTheme(darkVariant) : null);

	const composed = $derived<Theme>({
		id: src.id,
		label,
		inputs: main.inputs,
		overrides: main.overrides,
		...(darkVariant ? { dark: darkVariant } : {}),
	});

	// Which column the live preview shows: a paired theme follows the mode, a single-mode
	// one always shows its only variant.
	const previewing = $derived(paired ? theme.effectiveMode : mainMode);

	// Quick hue chips for the neutral tint (Tailwind slate / gray / zinc / stone 500)
	const TINT_CHIPS = [
		{ label: 'Slate', hex: '#64748b' },
		{ label: 'Gray', hex: '#6b7280' },
		{ label: 'Zinc', hex: '#71717a' },
		{ label: 'Stone', hex: '#78716c' },
	];
	const RAIL_KINDS = ['accent', 'neutral', 'custom'] as const;

	const NEUTRAL_TOKENS = TOKENS.slice(0, 10);
	const ACCENT_TOKENS = TOKENS.slice(10, 15);

	// Live preview: every draft change restyles the whole app; leaving the editor (cancel,
	// save, navigation) restores the persisted theme. preview() resolves the composed theme
	// deeply and reads the mode, so the effect tracks every input, override and mode switch.
	$effect(() => {
		theme.preview(composed);
	});
	$effect(() => {
		// queueMicrotask escapes the teardown's reactive context: state reads
		// inside an effect teardown see the values from the effect's previous
		// run (here: from mount), which would restore the WRONG theme after
		// a save. A microtask reads live state instead.
		return () => queueMicrotask(() => theme.endPreview());
	});

	function railKind(i: ThemeInputs): (typeof RAIL_KINDS)[number] {
		if (i.rail?.startsWith('#')) return 'custom';
		// Single-mode themes without a rail input keep the page background on dark.
		return (i.rail as 'accent' | 'neutral' | undefined) ?? (i.mode === 'dark' ? 'neutral' : 'accent');
	}

	function railValue(kind: (typeof RAIL_KINDS)[number], current: string): RailInput {
		return kind === 'custom' ? current : kind;
	}

	// Simple inputs regenerate the ramps, so advanced tweaks are dropped — otherwise a
	// duplicated preset (all tokens pinned) would never change.
	function setMain<K extends keyof ThemeInputs>(key: K, value: ThemeInputs[K]) {
		main.inputs[key] = value;
		main.overrides = {};
	}

	function setDark<K extends keyof ThemeInputs>(key: K, value: ThemeInputs[K]) {
		darkInputs[key] = value;
		darkTweaks = {};
	}

	function setDerived(on: boolean) {
		if (!on) {
			// Untick: start from exactly what was showing.
			darkInputs = { ...main.inputs, mode: 'dark' };
			darkTweaks = {};
		}
		darkDerived = on;
	}

	function validHex(v: string) {
		return /^#[0-9a-f]{6}$/i.test(v);
	}

	function setMainOverride(token: Token, value: string) {
		if (!validHex(value)) return;
		if (value.toLowerCase() === mainGenerated[token].toLowerCase()) delete main.overrides[token];
		else main.overrides[token] = value.toLowerCase();
	}

	function setDarkOverride(token: Token, value: string) {
		if (!validHex(value)) return;
		if (value.toLowerCase() === darkBase[token].toLowerCase()) delete darkTweaks[token];
		else darkTweaks[token] = value.toLowerCase();
	}

	/** Pair a single-mode theme: a light-only one gets a derived dark variant; a dark-only
	 *  one moves to the dark column unchanged and gets a generated light variant. */
	function addOtherVariant() {
		if (mainMode === 'dark') {
			const old = $state.snapshot(main);
			darkInputs = { ...old.inputs };
			darkTweaks = tweaksOver(pinTokens(resolveTheme(old)), generatePairedDark(old.inputs));
			darkDerived = false;
			main = { inputs: { ...old.inputs, mode: 'light' }, overrides: {} };
		} else {
			darkDerived = true;
		}
		paired = true;
	}

	function save() {
		const name = label.trim();
		if (!name) {
			error = 'Give the theme a name.';
			return;
		}
		const clash = theme.all.some(
			(t) => t.id !== src.id && t.label.trim().toLowerCase() === name.toLowerCase()
		);
		if (clash) {
			error = `A theme named “${name}” already exists.`;
			return;
		}
		label = name;
		onsave(JSON.parse(JSON.stringify(composed)));
	}

	const fieldLabel = 'block text-sm font-medium text-n-700 mb-1';
	const colorInput = 'h-8 w-14 cursor-pointer rounded border border-n-300 bg-surface';
</script>

{#snippet railControl(inputs: ThemeInputs, resolvedRail: string, set: (v: RailInput) => void)}
	{@const kind = railKind(inputs)}
	<div class="flex items-center gap-2">
		<div class="inline-flex overflow-hidden rounded-md border border-n-300" role="radiogroup" aria-label="Rail">
			{#each RAIL_KINDS as k, i (k)}
				<button
					type="button"
					role="radio"
					aria-checked={kind === k}
					onclick={() => set(railValue(k, resolvedRail))}
					class="px-3 py-1.5 text-sm capitalize {i > 0 ? 'border-l border-n-300' : ''} {kind === k
						? 'bg-a-600 text-on-accent'
						: 'bg-surface text-n-700 hover:bg-n-100'}"
				>
					{k}
				</button>
			{/each}
		</div>
		{#if kind === 'custom'}
			<input
				type="color"
				aria-label="Rail color"
				value={resolvedRail}
				oninput={(e) => set(e.currentTarget.value)}
				class="h-8 w-10 cursor-pointer rounded border border-n-300 bg-surface"
			/>
		{/if}
	</div>
{/snippet}

{#snippet strips(resolved: TokenMap, dim: boolean)}
	<div class="flex flex-col gap-2 {dim ? 'opacity-70' : ''}">
		<div class="flex overflow-hidden rounded-md border border-n-200">
			{#each NEUTRAL_TOKENS as t (t)}
				<span class="h-[22px] flex-1" title="{t} {resolved[t]}" style="background:{resolved[t]}"></span>
			{/each}
		</div>
		<div class="flex items-center gap-2">
			<span class="flex flex-1 overflow-hidden rounded-md border border-n-200">
				{#each ACCENT_TOKENS as t (t)}
					<span class="h-[22px] flex-1" title="{t} {resolved[t]}" style="background:{resolved[t]}"></span>
				{/each}
			</span>
			{#each ['surface', 'rail', 'danger'] as const as t (t)}
				<span
					class="size-[22px] shrink-0 rounded-full border border-n-200"
					title="{t} {resolved[t]}"
					style="background:{resolved[t]}"
				></span>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet advanced(
	resolved: TokenMap,
	overrides: Partial<TokenMap>,
	set: (t: Token, v: string) => void,
	reset: (t: Token) => void
)}
	<div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
		{#each TOKENS as t (t)}
			<div class="flex min-w-0 items-center gap-2">
				<input
					type="color"
					value={resolved[t]}
					oninput={(e) => set(t, e.currentTarget.value)}
					class="h-6 w-9 shrink-0 cursor-pointer rounded border border-n-300 bg-surface"
				/>
				<span class="flex-1 truncate font-mono text-xs text-n-600">{t}</span>
				{#if t in overrides}
					<button
						type="button"
						title="Reset to generated"
						onclick={() => reset(t)}
						class="text-xs text-n-500 hover:text-n-700"
					>
						↺
					</button>
				{/if}
			</div>
		{/each}
	</div>
{/snippet}

{#snippet header(mode: 'light' | 'dark')}
	<span class="inline-flex items-center gap-1.5 text-[13px] font-[650] text-n-900">
		{#if mode === 'dark'}<Moon size={15} />{:else}<Sun size={15} />{/if}
		<span class="capitalize">{mode}</span>
	</span>
	{#if previewing === mode}
		<span class="rounded-full bg-a-50 px-2 py-0.5 text-[11px] uppercase tracking-[0.04em] text-a-700">
			previewing
		</span>
	{/if}
{/snippet}

<div class="rounded-lg border border-n-200 bg-n-50 p-4 space-y-4">
	<div class="flex flex-wrap items-end gap-4">
		<div>
			<label for="theme-name" class={fieldLabel}>Name</label>
			<input
				id="theme-name"
				type="text"
				bind:value={label}
				oninput={() => (error = '')}
				class="w-44 rounded-lg border border-n-300 bg-surface px-3 py-1.5 text-sm field-focus"
			/>
		</div>

		<div>
			<label for="theme-accent" class={fieldLabel}>Accent</label>
			<div class="flex items-center gap-2">
				<input
					id="theme-accent"
					type="color"
					value={main.inputs.accent}
					oninput={(e) => setMain('accent', e.currentTarget.value)}
					class={colorInput}
				/>
				<span class="font-mono text-xs text-n-600">{main.inputs.accent}</span>
			</div>
		</div>

		<div>
			<label for="theme-tint" class={fieldLabel}>Neutral tint</label>
			<div class="flex items-center gap-2">
				<input
					id="theme-tint"
					type="color"
					value={main.inputs.tint}
					oninput={(e) => setMain('tint', e.currentTarget.value)}
					class={colorInput}
				/>
				{#each TINT_CHIPS as chip (chip.hex)}
					<button
						type="button"
						title={chip.label}
						onclick={() => setMain('tint', chip.hex)}
						class="size-6 rounded-full border border-n-300 {main.inputs.tint === chip.hex ? 'outline-2 outline-a-600' : ''}"
						style="background:{chip.hex}"
					></button>
				{/each}
			</div>
		</div>

		<div>
			<span class={fieldLabel}>Rail</span>
			{@render railControl(main.inputs, mainResolved.rail, (v) => setMain('rail', v))}
		</div>
	</div>

	<div class="grid gap-4 {paired ? 'md:grid-cols-2' : ''}">
		<!-- The theme's own variant: Light for a paired theme. -->
		<div class="flex flex-col gap-2.5 rounded-lg border border-n-200 bg-surface p-3.5">
			<div class="flex items-center justify-between gap-2">
				{@render header(mainMode)}
				{#if !paired}
					<button type="button" onclick={addOtherVariant} class="text-xs text-a-600 underline hover:text-a-700">
						Add a {mainMode === 'dark' ? 'light' : 'dark'} variant
					</button>
				{/if}
			</div>
			<ThemeMiniature vars={resolveThemeCss(main)} />
			{@render strips(mainResolved, false)}
			<div>
				<button
					type="button"
					onclick={() => (advancedMain = !advancedMain)}
					class="text-sm text-a-600 underline hover:text-a-700"
				>
					{advancedMain ? 'Hide advanced' : 'Advanced: edit individual colors'}
				</button>
				{#if Object.keys(main.overrides).length > 0}
					<span class="ml-2 text-xs text-n-500">Has manual tweaks — changing Accent/Tint/Rail resets them.</span>
				{/if}
			</div>
			{#if advancedMain}
				{@render advanced(mainResolved, main.overrides, setMainOverride, (t) => delete main.overrides[t])}
			{/if}
		</div>

		{#if paired && darkVariant && darkResolved}
			<div class="flex flex-col gap-2.5 rounded-lg border border-n-200 bg-surface p-3.5">
				<div class="flex items-center justify-between gap-2">
					<span class="flex items-center gap-2">{@render header('dark')}</span>
					<label class="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-n-700">
						<input
							type="checkbox"
							class="peer sr-only"
							checked={darkDerived}
							onchange={(e) => setDerived(e.currentTarget.checked)}
						/>
						<span
							class="grid size-3.5 place-items-center rounded peer-focus-visible:outline-2 peer-focus-visible:outline-a-600 {darkDerived
								? 'bg-a-600 text-on-accent'
								: 'border-[1.5px] border-n-300'}"
						>
							{#if darkDerived}<Check size={10} strokeWidth={3.5} />{/if}
						</span>
						Derive from light
					</label>
				</div>
				<ThemeMiniature vars={resolveThemeCss(darkVariant)} />
				{@render strips(darkResolved, darkDerived)}
				{#if darkDerived}
					<p class="text-xs text-n-500 text-pretty">
						Generated from the light variant. Untick to set its own accent, tint and rail, or edit
						steps in Advanced.
					</p>
				{:else}
					<div class="flex flex-wrap items-end gap-3">
						<div>
							<label for="theme-dark-accent" class={fieldLabel}>Accent</label>
							<input
								id="theme-dark-accent"
								type="color"
								value={darkInputs.accent}
								oninput={(e) => setDark('accent', e.currentTarget.value)}
								class={colorInput}
							/>
						</div>
						<div>
							<label for="theme-dark-tint" class={fieldLabel}>Tint</label>
							<input
								id="theme-dark-tint"
								type="color"
								value={darkInputs.tint}
								oninput={(e) => setDark('tint', e.currentTarget.value)}
								class={colorInput}
							/>
						</div>
						<div>
							<span class={fieldLabel}>Rail</span>
							{@render railControl(darkInputs, darkResolved.rail, (v) => setDark('rail', v))}
						</div>
					</div>
					<div>
						<button
							type="button"
							onclick={() => (advancedDark = !advancedDark)}
							class="text-sm text-a-600 underline hover:text-a-700"
						>
							{advancedDark ? 'Hide advanced' : 'Advanced: edit individual colors'}
						</button>
					</div>
					{#if advancedDark}
						{@render advanced(darkResolved, darkTweaks, setDarkOverride, (t) => delete darkTweaks[t])}
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	{#if error}
		<p class="text-sm text-danger">{error}</p>
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-3 border-t border-n-200 pt-3">
		<p class="text-xs text-n-500 text-pretty">
			{#if paired}
				Live preview follows the mode you’re in — switch mode in the rail to check the other variant.
			{:else}
				A {mainMode}-only theme looks the same in every mode.
			{/if}
		</p>
		<div class="flex gap-2">
			<button type="button" onclick={oncancel} class="rounded-md px-4 py-2 text-sm text-n-600 hover:bg-n-100">
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
</div>
