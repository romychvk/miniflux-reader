<script lang="ts">
	import { X, Download, Upload, PlugZap, RotateCw, Rss } from 'lucide-svelte';
	import type { AiProvider } from '$lib/types';
	import { backend, caps } from '$lib/backend';
	import type { OpmlImportReport } from '$lib/backend/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { aiConfig } from '$lib/stores/aiConfig.svelte';
	import { authedFetch } from '$lib/api';
	import { ui } from '$lib/stores/ui.svelte';
	import { appSettings, APP_SETTINGS_SECTIONS, APP_SETTINGS_ICONS } from '$lib/stores/appSettings.svelte';
	import { exportSettings, importSettings } from '$lib/settingsBackup';
	import { settingsSync } from '$lib/settingsSync.svelte';
	import AppearanceSection from '$lib/components/settings/AppearanceSection.svelte';

	const ANTHROPIC_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'];

	// The section list lives in the sidebar (SettingsNav); on phones there is no sidebar column,
	// so the same list shows as tabs above the card.
	const activeSection = $derived(appSettings.section);

	// Shared look of the settings cards and their fields.
	const pageTitle = 'text-[22px] font-bold tracking-[-0.01em] text-n-900';
	const pageDesc = 'mt-1.5 text-sm text-n-500 text-pretty';
	const card = 'rounded-xl bg-surface px-8 py-7 shadow-card max-md:px-5 max-md:py-5';
	const label = 'mb-1.5 block text-[13px] font-medium text-n-700';
	const field = 'h-9.5 w-full max-w-md rounded-lg border border-n-300 bg-surface px-3 text-sm text-n-900 field-focus';
	const secondaryBtn = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-semibold text-n-700 shadow-[0_0_0_1px_var(--color-n-300)] transition-colors hover:bg-n-100';
	const primaryBtn = 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-a-600 px-4.5 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-a-700';

	// aiConfig is initialised in the (app) layout, which gates rendering on `ready`,
	// so the store values are populated by the time this page mounts.
	// svelte-ignore state_referenced_locally
	let provider = $state<AiProvider>(aiConfig.provider);
	// svelte-ignore state_referenced_locally
	let model = $state(aiConfig.model);
	// svelte-ignore state_referenced_locally
	let apiKey = $state(aiConfig.apiKey);

	const aiDirty = $derived(
		provider !== aiConfig.provider || model !== aiConfig.model || apiKey !== aiConfig.apiKey
	);

	let savedAt = $state(0);
	let testing = $state(false);
	// Inline status shown inside the AI Assistant card (instead of a global toast).
	let status = $state<{ ok: boolean; text: string } | null>(null);

	function selectProvider(p: AiProvider) {
		if (provider === p) return;
		provider = p;
		status = null;
		// Reset to a sensible default for the new provider.
		model = aiConfig.defaultModels[p];
	}

	function goBack() {
		history.back();
	}

	function handleSave() {
		status = null;
		aiConfig.save({ provider, model, apiKey });
		// Reflect any normalisation (default model fill-in) back into the form.
		model = aiConfig.model;
		const at = (savedAt = Date.now());
		// "Saved" is a short-lived acknowledgement, not a standing state.
		setTimeout(() => {
			if (savedAt === at) savedAt = 0;
		}, 2000);
		ui.showSuccess('AI settings saved.');
	}

	async function testConnection() {
		if (!apiKey.trim() || !model.trim()) {
			status = { ok: false, text: 'Enter a model and API key first.' };
			return;
		}
		testing = true;
		status = null;
		try {
			// /api/ai is gated on the Miniflux credential like the other helper endpoints (8022ebc);
			// a bare fetch here answered 401 "Missing server or token" to every test.
			const res = await authedFetch('/api/ai', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-AI-Key': apiKey.trim() },
				body: JSON.stringify({
					provider,
					model: model.trim(),
					system: 'You are a connection test.',
					messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
					maxTokens: 16
				})
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
			status = { ok: true, text: `Connection OK — model replied: "${(data?.text || '').trim().slice(0, 40)}"` };
		} catch (e) {
			status = { ok: false, text: e instanceof Error ? e.message : 'Connection failed' };
		} finally {
			testing = false;
		}
	}

	function handleClear() {
		aiConfig.clear();
		provider = aiConfig.provider;
		model = aiConfig.model;
		apiKey = '';
		savedAt = 0;
		ui.showSuccess('AI settings cleared.');
	}

	// --- Backup & restore --------------------------------------------------------------
	let includeSecrets = $state(true);
	let fileInput = $state<HTMLInputElement | null>(null);

	// Subscriptions as OPML: a download, and an upload the backend subscribes from. What comes
	// back is counts per feed or just a message, depending on the backend.
	const hasOpml = caps().opml;
	let opmlInput = $state<HTMLInputElement | null>(null);
	let opmlBusy = $state(false);
	let opmlReport = $state<OpmlImportReport | null>(null);
	let opmlError = $state<string | null>(null);
	async function exportOpml() {
		opmlError = null;
		try {
			const xml = await backend().exportOpml!();
			const url = URL.createObjectURL(new Blob([xml], { type: 'text/x-opml' }));
			const a = document.createElement('a');
			a.href = url;
			a.download = `miniflux-reader-${new Date().toISOString().slice(0, 10)}.opml`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch (e) {
			opmlError = e instanceof Error ? e.message : 'Export failed';
		}
	}
	async function onOpmlFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		opmlBusy = true;
		opmlError = null;
		opmlReport = null;
		try {
			opmlReport = await backend().importOpml!(await file.text());
			if (opmlReport.added === undefined || opmlReport.added > 0) await feeds.loadFeeds();
		} catch (err) {
			opmlError = err instanceof Error ? err.message : 'Import failed';
		} finally {
			opmlBusy = false;
		}
	}

	function doExport() {
		exportSettings(includeSecrets);
		ui.showSuccess('Settings exported.');
	}

	async function onImportFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-selecting the same file later
		if (!file) return;
		if (
			!confirm(
				'Import settings from this file? Matching settings in this browser will be overwritten and the page will reload.'
			)
		)
			return;
		try {
			const n = importSettings(await file.text());
			// Without this the post-reload boot would see clean-vs-server state and
			// overwrite the freshly imported settings with the server's copy.
			settingsSync.markDirty();
			ui.showSuccess(`Imported ${n} settings. Reloading…`);
			setTimeout(() => location.reload(), 700);
		} catch (err) {
			ui.showError(err instanceof Error ? err.message : 'Import failed');
		}
	}
</script>

<!-- Close button on a sticky, zero-height bar: it measures against the scroll container's content
     area, so it can't drift under the scrollbar the way a `fixed right-4` would. This route hides
     the app top bar, so the button sits at the very top of the scrollport. -->
<div class="sticky top-0 z-30 h-0">
	<button
		type="button"
		onclick={goBack}
		title="Close settings"
		aria-label="Close settings"
		class="absolute right-2 md:right-4 top-2 rounded-full p-1.75 text-n-700 bg-surface shadow-md hover:bg-n-100 hover:text-n-900"
	>
		<X class="size-6.5" />
	</button>
</div>

<div class="flex w-full max-w-200 flex-col gap-5 px-10 py-9 max-md:px-3 max-md:py-4">
	{#if ui.isMobile}
		<!-- The tabs share their row with the floating Close button — keep clear of it. -->
		<!-- Same tabs as Feed Settings' on a phone: icon + label. -->
		<ul class="flex gap-1 overflow-x-auto pr-11 flex-wrap">
			{#each APP_SETTINGS_SECTIONS as item (item.id)}
				{@const Icon = APP_SETTINGS_ICONS[item.id]}
				{@const active = activeSection === item.id}
				<li class="shrink-0">
					<button
						type="button"
						onclick={() => (appSettings.section = item.id)}
						aria-current={active ? 'page' : undefined}
						class="flex max-md:border max-md:border-n-300 h-9 items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-[13.5px] transition-colors {active
							? 'bg-a-600/12 font-[650] text-a-700'
							: 'font-[450] text-n-700 hover:bg-n-200/60'}"
					>
						<Icon size={16} class="shrink-0 {active ? '' : 'text-n-500'}" />{item.label}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<AppearanceSection active={activeSection === 'appearance'} />

	<section class:hidden={activeSection !== 'ai'} class="space-y-5">
		<div>
			<h1 class={pageTitle}>AI Assistant</h1>
			<p class={pageDesc}>
				Used to suggest Scraper &amp; Rewrite rules from a feed's settings screen. Your API key is
				stored only in this browser and forwarded per request — never saved on the server.
			</p>
		</div>

		<div class="{card} space-y-5">
			<div>
				<div class={label}>Provider</div>
				<div class="flex flex-wrap gap-2.5">
					{#each [{ id: 'anthropic', label: 'Anthropic (Claude)' }, { id: 'openai', label: 'OpenAI' }] as opt (opt.id)}
						<button
							type="button"
							onclick={() => selectProvider(opt.id as AiProvider)}
							aria-pressed={provider === opt.id}
							class="h-9.5 rounded-[10px] px-3.5 text-sm transition-[background-color,box-shadow] {provider === opt.id
								? 'bg-a-50 font-[650] text-a-700 shadow-[0_0_0_2px_var(--color-a-600)]'
								: 'text-n-700 shadow-[0_0_0_1px_var(--color-n-200)] hover:bg-n-50 hover:shadow-[0_0_0_1px_var(--color-n-300)]'}"
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>

			<div>
				<label for="ai-model" class={label}>Model</label>
				{#if provider === 'anthropic'}
					<select id="ai-model" bind:value={model} class={field}>
						{#each ANTHROPIC_MODELS as m (m)}
							<option value={m}>{m}</option>
						{/each}
						{#if model && !ANTHROPIC_MODELS.includes(model)}
							<option value={model}>{model}</option>
						{/if}
					</select>
				{:else}
					<input
						id="ai-model"
						type="text"
						bind:value={model}
						spellcheck="false"
						placeholder="gpt-4o"
						class="{field} font-mono"
					/>
				{/if}
			</div>

			<div>
				<label for="ai-key" class={label}>API key</label>
				<input
					id="ai-key"
					type="password"
					bind:value={apiKey}
					autocomplete="off"
					spellcheck="false"
					placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
					class="{field} font-mono"
				/>
			</div>

			{#if status}
				<div
					class="rounded-lg border px-3 py-2 text-sm {status.ok
						? 'border-success/30 bg-success/10 text-success'
						: 'border-danger/30 bg-danger/10 text-danger'}"
				>
					{status.text}
				</div>
			{/if}
		</div>

		<!-- Action row under the card: Save only while the form differs from what is stored. -->
		<div class="flex flex-wrap items-center gap-2.5 px-1">
			{#if aiDirty}
				<button type="button" onclick={handleSave} class={primaryBtn}>Save</button>
			{/if}
			<button
				type="button"
				onclick={testConnection}
				class="{secondaryBtn} {testing ? 'pointer-events-none' : ''}"
			>
				<PlugZap size={14} class={testing ? 'animate-pulse' : ''} />
				{testing ? 'Testing…' : 'Test connection'}
			</button>
			{#if aiConfig.isConfigured}
				<button
					type="button"
					onclick={handleClear}
					class="h-9 rounded-lg px-3.5 text-[13.5px] font-semibold text-danger transition-colors hover:bg-danger/8"
				>
					Clear
				</button>
			{/if}
			{#if aiDirty}
				<span class="ml-1 inline-flex items-center gap-1.5 text-[13px] text-n-500">
					<span class="size-1.5 rounded-full bg-warning"></span>
					Unsaved changes
				</span>
			{:else if savedAt}
				<span class="ml-1 text-sm text-n-500">Saved</span>
			{/if}
		</div>
	</section>

	<section class:hidden={activeSection !== 'backup'} class="space-y-5">
		<div>
			<h1 class={pageTitle}>Backup &amp; Restore</h1>
			<p class={pageDesc}>
				Your settings (feed RSS-Bridge / duplicate / cover rules, layout &amp; view preferences,
				feed order, themes) sync to your server automatically and follow you across browsers
				and devices. Export remains as a manual backup or to move settings between accounts.
			</p>
		</div>

		<div class="{card} flex flex-col gap-6">
			<div>
				<div class="mb-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-n-500">Sync</div>
				<p class="text-sm">
					{#if settingsSync.syncError}
						<span class="text-danger">{settingsSync.syncError} — settings are kept in this browser and will sync when the server is reachable.</span>
					{:else if settingsSync.lastSyncAt}
						<span class="text-success">Synced with server at {new Date(settingsSync.lastSyncAt).toLocaleTimeString()}.</span>
					{:else}
						<span class="text-n-500">Not synced yet in this session.</span>
					{/if}
				</p>
			</div>

			<div class="border-t border-n-200 pt-5">
				<div class="mb-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-n-500">Export</div>
				<div class="flex flex-wrap items-center gap-4">
					<button type="button" onclick={doExport} class={primaryBtn}>
						<Download size={14} />
						Export settings
					</button>
					<label class="flex items-center gap-2 text-sm text-n-700">
						<input type="checkbox" bind:checked={includeSecrets} class="rounded border-n-300" />
						Include API tokens
					</label>
				</div>
				{#if includeSecrets}
					<p class="mt-2 text-xs text-warning">
						The exported file will contain your Miniflux token and AI key — keep it private.
					</p>
				{/if}
			</div>

			<div class="border-t border-n-200 pt-5">
				<div class="mb-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-n-500">Import</div>
				<button type="button" onclick={() => fileInput?.click()} class={secondaryBtn}>
					<Upload size={14} />
					Import settings…
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="application/json,.json"
					class="hidden"
					onchange={onImportFile}
				/>
				<p class="mt-2 text-xs text-n-500">
					Overwrites matching settings in this browser, then reloads. Other data (caches) is kept.
				</p>
			</div>

			{#if hasOpml}
				<div class="border-t border-n-200 pt-5">
					<div class="mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-n-500">Subscriptions (OPML)</div>
					<p class="mb-3 text-xs text-n-500 text-pretty">
						Your categories and feeds as an OPML file — the format every reader exchanges. Importing subscribes to
						each feed in the file (folders become categories, feeds you already have are skipped); the entries
						arrive with the next fetch.
					</p>
					<div class="flex flex-wrap items-center gap-2.5">
						<button type="button" onclick={exportOpml} class={secondaryBtn}>
							<Rss size={14} />
							Export OPML
						</button>
						<button
							type="button"
							onclick={() => opmlInput?.click()}
							class="{secondaryBtn} {opmlBusy ? 'pointer-events-none' : ''}"
						>
							{#if opmlBusy}<RotateCw size={14} class="animate-spin" />{:else}<Upload size={14} />{/if}
							{opmlBusy ? 'Importing…' : 'Import OPML…'}
						</button>
						<input bind:this={opmlInput} type="file" accept=".opml,.xml,text/xml,application/xml,text/x-opml" class="hidden" onchange={onOpmlFile} />
					</div>
					{#if opmlError}
						<p class="mt-2 text-xs text-danger">{opmlError}</p>
					{/if}
					{#if opmlReport}
						{#if opmlReport.added !== undefined}
							<p class="mt-2 text-xs {opmlReport.added > 0 ? 'text-success' : 'text-n-600'}">
								Added {opmlReport.added}{opmlReport.categoriesCreated ? ` (${opmlReport.categoriesCreated} new categories)` : ''}{opmlReport.exists ? `, already subscribed ${opmlReport.exists}` : ''}{opmlReport.invalid ? `, invalid URL ${opmlReport.invalid}` : ''}{opmlReport.limit ? `, over the plan's feed limit ${opmlReport.limit}` : ''}.
							</p>
							{#if opmlReport.rows?.some((r) => r.status !== 'added')}
								<ul class="mt-1 max-h-40 overflow-y-auto text-xs text-n-500">
									{#each opmlReport.rows.filter((r) => r.status !== 'added') as r (r.xmlUrl)}
										<li class="truncate"><span class="text-n-400">{r.status}</span> · {r.title} <span class="text-n-400">{r.xmlUrl}</span></li>
									{/each}
								</ul>
							{/if}
						{:else}
							<p class="mt-2 text-xs text-success">{opmlReport.message ?? 'Imported.'}</p>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</section>
</div>
