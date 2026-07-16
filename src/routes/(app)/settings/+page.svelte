<script lang="ts">
	import { X, Download, Upload } from 'lucide-svelte';
	import type { AiProvider } from '$lib/types';
	import { aiConfig } from '$lib/stores/aiConfig.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { exportSettings, importSettings } from '$lib/settingsBackup';
	import { settingsSync } from '$lib/settingsSync.svelte';
	import AppearanceSection from '$lib/components/settings/AppearanceSection.svelte';

	const ANTHROPIC_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'];

	// aiConfig is initialised in the (app) layout, which gates rendering on `ready`,
	// so the store values are populated by the time this page mounts.
	// svelte-ignore state_referenced_locally
	let provider = $state<AiProvider>(aiConfig.provider);
	// svelte-ignore state_referenced_locally
	let model = $state(aiConfig.model);
	// svelte-ignore state_referenced_locally
	let apiKey = $state(aiConfig.apiKey);

	let saving = $state(false);
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
		saving = true;
		status = null;
		aiConfig.save({ provider, model, apiKey });
		// Reflect any normalisation (default model fill-in) back into the form.
		model = aiConfig.model;
		savedAt = Date.now();
		saving = false;
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
			const res = await fetch('/api/ai', {
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
		ui.showSuccess('AI settings cleared.');
	}

	// --- Backup & restore --------------------------------------------------------------
	let includeSecrets = $state(true);
	let fileInput = $state<HTMLInputElement | null>(null);

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

<!-- Close button, fixed to the top-right corner of the main scroll region -->
<button
	type="button"
	onclick={goBack}
	title="Close"
	aria-label="Close"
	class="fixed right-4 md:right-6 top-14 z-30 rounded-full p-1.5 text-n-700 bg-surface hover:text-n-900"
>
	<X class="size-7.5" />
</button>

<div class="w-full max-w-3xl px-4 py-6 sm:px-6">
	<h2 class="mb-6 px-1 text-lg font-semibold text-n-800">Settings</h2>

	<AppearanceSection />

	<section class="mt-6 rounded-lg border border-n-100 bg-surface p-5 shadow-xl">
		<h3 class="mb-1 text-sm font-semibold uppercase tracking-wide text-n-500">AI Assistant</h3>
		<p class="mb-4 text-sm text-n-500">
			Used to suggest Scraper &amp; Rewrite rules from a feed's settings screen. Your API key is
			stored only in this browser and forwarded per request — never saved on the server.
		</p>

		<div class="space-y-4">
			<div>
				<div class="mb-1 block text-sm font-medium text-n-700">Provider</div>
				<div class="flex gap-2">
					{#each [{ id: 'anthropic', label: 'Anthropic (Claude)' }, { id: 'openai', label: 'OpenAI' }] as opt (opt.id)}
						<button
							type="button"
							onclick={() => selectProvider(opt.id as AiProvider)}
							class={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
								provider === opt.id
									? 'border-a-600 bg-a-50 font-medium text-a-700'
									: 'border-n-300 text-n-700 hover:bg-n-100'
							}`}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>

			<div>
				<label for="ai-model" class="mb-1 block text-sm font-medium text-n-700">Model</label>
				{#if provider === 'anthropic'}
					<select
						id="ai-model"
						bind:value={model}
						class="w-full max-w-md rounded-md border border-n-300 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					>
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
						class="w-full max-w-md rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					/>
				{/if}
			</div>

			<div>
				<label for="ai-key" class="mb-1 block text-sm font-medium text-n-700">API key</label>
				<input
					id="ai-key"
					type="password"
					bind:value={apiKey}
					autocomplete="off"
					spellcheck="false"
					placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
					class="w-full max-w-md rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
			</div>

			<div class="flex flex-wrap items-center gap-3 pt-1">
				<button
					type="button"
					onclick={handleSave}
					disabled={saving}
					class="rounded-md bg-a-600 px-4 py-2 text-sm text-on-accent hover:bg-a-700 disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
				<button
					type="button"
					onclick={testConnection}
					disabled={testing}
					class="rounded-md border border-n-300 px-4 py-2 text-sm text-n-700 hover:bg-n-100 disabled:opacity-50"
				>
					{testing ? 'Testing…' : 'Test connection'}
				</button>
				{#if aiConfig.isConfigured}
					<button
						type="button"
						onclick={handleClear}
						class="rounded-md px-3 py-2 text-sm text-danger hover:bg-danger/10"
					>
						Clear
					</button>
				{/if}
				{#if savedAt}
					<span class="text-sm text-n-500">Saved</span>
				{/if}
			</div>

			{#if status}
				<div
					class={`rounded-md border px-3 py-2 text-sm ${
						status.ok
							? 'border-success/30 bg-success/10 text-success'
							: 'border-danger/30 bg-danger/10 text-danger'
					}`}
				>
					{status.text}
				</div>
			{/if}
		</div>
	</section>

	<section class="mt-6 rounded-lg border border-n-100 bg-surface p-5 shadow-xl">
		<h3 class="mb-1 text-sm font-semibold uppercase tracking-wide text-n-500">Backup &amp; Restore</h3>
		<p class="mb-2 text-sm text-n-500">
			Your settings (feed RSS-Bridge / duplicate / cover rules, layout &amp; view preferences,
			feed order, themes) sync to your server automatically and follow you across browsers
			and devices. Export remains as a manual backup or to move settings between accounts.
		</p>
		<p class="mb-4 text-xs">
			{#if settingsSync.syncError}
				<span class="text-danger">{settingsSync.syncError} — settings are kept in this browser and will sync when the server is reachable.</span>
			{:else if settingsSync.lastSyncAt}
				<span class="text-success">Synced with server at {new Date(settingsSync.lastSyncAt).toLocaleTimeString()}.</span>
			{:else}
				<span class="text-n-500">Not synced yet in this session.</span>
			{/if}
		</p>

		<div class="space-y-4">
			<div class="flex flex-wrap items-center gap-3">
				<button
					type="button"
					onclick={doExport}
					class="inline-flex items-center gap-1.5 rounded-md bg-a-600 px-4 py-2 text-sm text-on-accent hover:bg-a-700"
				>
					<Download class="h-4 w-4" />
					Export settings
				</button>
				<label class="flex items-center gap-2 text-sm text-n-700">
					<input type="checkbox" bind:checked={includeSecrets} class="rounded border-n-300" />
					Include API tokens
				</label>
			</div>
			{#if includeSecrets}
				<p class="-mt-1 text-xs text-warning">
					The exported file will contain your Miniflux token and AI key — keep it private.
				</p>
			{/if}

			<div>
				<button
					type="button"
					onclick={() => fileInput?.click()}
					class="inline-flex items-center gap-1.5 rounded-md border border-n-300 px-4 py-2 text-sm text-n-700 hover:bg-n-100"
				>
					<Upload class="h-4 w-4" />
					Import settings…
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="application/json,.json"
					class="hidden"
					onchange={onImportFile}
				/>
				<p class="mt-1 text-xs text-n-500">
					Overwrites matching settings in this browser, then reloads. Other data (caches) is kept.
				</p>
			</div>
		</div>
	</section>
</div>
