<script lang="ts">
	import { onMount } from 'svelte';
	import { Copy, Check, FlaskConical } from 'lucide-svelte';
	import type { FeedCreate } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { NEW_CATEGORY_SENTINEL } from '$lib/category';
	import CategorySelect from './CategorySelect.svelte';
	import { storageSet } from '$lib/storage';
	import { buildRssBridgeUrl, RSS_BRIDGE_INSTANCE_KEY, type RssBridgeParam } from '$lib/rssbridge';
	import { testBridgeUrl, type BridgeTestResult } from '$lib/scrapedFeed';
	import { detectBridgeParams } from '$lib/bridgeFinder';
	import type { BridgeMatch, BridgeParam } from '$lib/rssbridgeCatalog';

	// Configure a ready-made bridge the instance already ships (BandcampBridge, RedditBridge…), as
	// opposed to ScrapedFeedWizard, which hand-builds a CssSelectorBridge for sites nobody wrote a
	// bridge for. The whole form is generated from the instance's own ?action=list metadata, so there
	// is no per-bridge code here.

	let { onclose, onsave, bridge, instance, sourceUrl, initialCategoryId }: {
		onclose: () => void;
		onsave: (data: FeedCreate) => Promise<void>;
		bridge: BridgeMatch;
		instance: string;
		// What the user typed in Add Feed. Not parsed here — deriving params locally (band = subdomain…)
		// is bridge-specific guesswork that doesn't generalise. Instead the instance's own action=detect
		// (onMount below) resolves params from it, and when it can, we prefill and skip the form.
		sourceUrl?: string;
		initialCategoryId?: number;
	} = $props();

	// svelte-ignore state_referenced_locally
	let contextName = $state(bridge.contexts[0]?.name ?? '');

	// Keyed by param name and deliberately shared across contexts: switching Bandcamp's "By tag" to
	// "By band" keeps `limit`, and only the active context's params reach the URL anyway.
	function initialValues(): Record<string, string | boolean> {
		const values: Record<string, string | boolean> = {};
		for (const context of bridge.contexts) {
			for (const param of context.params) {
				if (param.name in values) continue;
				if (param.type === 'checkbox') {
					values[param.name] = param.defaultValue === 'true' || param.defaultValue === 'on';
				} else if (param.type === 'list') {
					// The bridge's own declared default, else the first option so the select is never
					// blank — not auto-fill from the typed URL.
					values[param.name] = param.defaultValue ?? param.options?.[0]?.value ?? '';
				} else {
					values[param.name] = param.defaultValue ?? '';
				}
			}
		}
		return values;
	}
	// svelte-ignore state_referenced_locally
	let values = $state<Record<string, string | boolean>>(initialValues());

	let categoryId: number = $state(0);
	let newCategoryName = $state('');
	$effect(() => {
		if (!categoryId)
			categoryId = initialCategoryId ?? feeds.getNoCategoryId() ?? feeds.getCategories()[0]?.id ?? 0;
	});
	// Unlike the scraped-feed wizard, a real bridge returns real content, so leave this off.
	let crawler = $state(false);

	// Prefill via the instance's action=detect (see the sourceUrl prop note). With a sourceUrl we open
	// in "detecting" and then reveal either the auto-filled summary or the form; with none, there's
	// nothing to detect so the form shows at once.
	// Reading the props once here is the point — detection runs a single time in onMount.
	// svelte-ignore state_referenced_locally
	const willDetect = Boolean(sourceUrl && instance.trim());
	let detecting = $state(willDetect);
	let formOpen = $state(!willDetect);
	let autoDetected = $state(false);

	function paramType(name: string): BridgeParam['type'] | undefined {
		for (const context of bridge.contexts) {
			const param = context.params.find((p) => p.name === name);
			if (param) return param.type;
		}
		return undefined;
	}

	// Map detected params onto `values`, honouring a detected context and checkbox typing (a bare
	// string value would never match the `=== true` the URL builder checks for). Returns true only
	// when the active context has every required field filled — the bar for skipping the form; less
	// than that falls through to the form with whatever was prefilled.
	function applyDetected(params: Record<string, string>): boolean {
		const { context, ...rest } = params;
		if (context && bridge.contexts.some((c) => c.name === context)) contextName = context;

		let appliedAny = false;
		for (const [name, value] of Object.entries(rest)) {
			const type = paramType(name);
			if (!type) continue; // not a param this bridge declares — ignore
			values[name] =
				type === 'checkbox' ? value === 'on' || value === 'true' || value === '1' : value;
			appliedAny = true;
		}
		if (!appliedAny) return false;

		const active = bridge.contexts.find((c) => c.name === contextName);
		const stillMissing = (active?.params ?? []).some(
			(p) => p.required && p.type !== 'checkbox' && !String(values[p.name] ?? '').trim()
		);
		return !stillMissing;
	}

	onMount(async () => {
		if (!willDetect) return;
		const detected = await detectBridgeParams(sourceUrl!, instance);
		detecting = false;
		// Only trust a hit for the very bridge this wizard opened for: a github.com URL can detect a
		// different github bridge than the one the user picked from the list.
		if (detected && detected.bridge === bridge.key && applyDetected(detected.params)) {
			autoDetected = true; // formOpen stays false → the form is skipped
		} else {
			formOpen = true;
		}
	});

	let testing = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);
	let testedUrl = $state('');
	let saving = $state(false);
	let copied = $state(false);

	const currentContext = $derived(bridge.contexts.find((c) => c.name === contextName));

	function displayValue(param: BridgeParam, value: string | boolean): string {
		if (param.type === 'checkbox') return 'Yes';
		if (param.type === 'list') return param.options?.find((o) => o.value === value)?.label ?? String(value);
		return String(value);
	}

	// The filled fields, shown as a read-only summary in place of the form we hid after auto-detect.
	const detectedSummary = $derived(
		(currentContext?.params ?? [])
			.filter((p) => (p.type === 'checkbox' ? values[p.name] === true : String(values[p.name] ?? '').trim() !== ''))
			.map((p) => ({ label: p.label, value: displayValue(p, values[p.name]) }))
	);

	const bridgeUrl = $derived.by(() => {
		if (!currentContext || !instance.trim()) return '';

		const params: RssBridgeParam[] = [];
		for (const param of currentContext.params) {
			// buildRssBridgeUrl sets action/bridge first and then loops searchParams.set over params,
			// so a bridge declaring a param with either name would silently rewrite the request.
			if (param.name === 'action' || param.name === 'bridge') continue;

			const value = values[param.name];
			if (param.type === 'checkbox') {
				if (value === true) params.push({ key: param.name, value: 'on' });
				continue;
			}
			const text = String(value ?? '').trim();
			if (text) params.push({ key: param.name, value: text });
		}

		// Last, so a bridge param can never shadow them. An empty context name means a single-context
		// bridge (RSS-Bridge keys those by `0`), where ?context= is not a thing.
		if (contextName) params.push({ key: 'context', value: contextName });
		params.push({ key: 'format', value: 'Atom' });

		// sourceUrl: '' — buildRssBridgeUrl skips an empty source, which is what makes it work for
		// param-only bridges like Bandcamp that have no url/home_page param at all.
		return buildRssBridgeUrl({ instance, bridge: bridge.key, sourceUrl: '', params });
	});

	const missingRequired = $derived(
		(currentContext?.params ?? []).some(
			(p) => p.required && p.type !== 'checkbox' && !String(values[p.name] ?? '').trim()
		)
	);

	// A test outcome only counts for the URL it ran against.
	const testCurrent = $derived(testedUrl === bridgeUrl ? testResult : null);

	// Options come back flattened with an optional group; rebuild the optgroups for rendering.
	function groupsOf(param: BridgeParam): { group: string; options: { label: string; value: string }[] }[] {
		const groups: { group: string; options: { label: string; value: string }[] }[] = [];
		for (const option of param.options ?? []) {
			const key = option.group ?? '';
			let bucket = groups.find((g) => g.group === key);
			if (!bucket) groups.push((bucket = { group: key, options: [] }));
			bucket.options.push({ label: option.label, value: option.value });
		}
		return groups;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function testBridge(): Promise<boolean> {
		if (!bridgeUrl || testing) return false;
		testing = true;
		const target = bridgeUrl;
		let result: BridgeTestResult;
		try {
			result = await testBridgeUrl(target, bridge.key);
		} finally {
			testing = false;
		}
		testResult = result;
		testedUrl = target;
		return result.ok;
	}

	async function handleCreate() {
		if (!bridgeUrl || saving || testing || detecting || missingRequired) return;
		if (categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim()) return;
		// First click runs the test; on failure the button becomes "Create anyway".
		if (!testCurrent && !(await testBridge())) return;
		saving = true;
		try {
			const categoryIdToUse = categoryId === NEW_CATEGORY_SENTINEL
				? (await feeds.createCategory(newCategoryName.trim())).id
				: categoryId;
			const data: FeedCreate = { feed_url: bridgeUrl, category_id: categoryIdToUse };
			if (crawler) data.crawler = true;
			await onsave(data);
			storageSet(RSS_BRIDGE_INSTANCE_KEY, instance.trim());
			onclose();
		} catch {
			// Error shown by store
		} finally {
			saving = false;
		}
	}

	async function copyUrl() {
		try {
			await navigator.clipboard.writeText(bridgeUrl);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable — the field is selectable anyway
		}
	}
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-40 bg-overlay/30" onclick={onclose}></div>

<div class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
	<div class="bg-surface rounded-lg shadow-xl w-full max-w-2xl mx-4 pointer-events-auto flex max-h-[90vh] flex-col">
		<div class="px-5 py-4 border-b border-n-200">
			<h2 class="text-lg font-semibold text-n-800">{bridge.name}</h2>
			{#if bridge.description}
				<p class="mt-0.5 text-xs text-n-500">{bridge.description}</p>
			{/if}
		</div>

		<div class="px-5 py-4 space-y-4 overflow-y-auto">
			{#if sourceUrl}
				<p class="text-xs text-n-500">
					{#if detecting}
						Detecting parameters from <span class="font-mono">{sourceUrl}</span>…
					{:else if autoDetected && !formOpen}
						Auto-filled from <span class="font-mono">{sourceUrl}</span>.
					{:else}
						A ready-made bridge for <span class="font-medium text-n-600">{bridge.host}</span>, from
						{instance}. Fill in what it needs below.
					{/if}
				</p>
			{/if}

			<!-- Three states: waiting on action=detect, the full form, or (after a confident detect) a
			     read-only summary with an Edit escape hatch. Content indentation is kept flat to avoid
			     re-indenting the whole param form. -->
			{#if detecting}
				<!-- the note above reads "Detecting…"; nothing to show until it resolves -->
			{:else if formOpen}
			{#if bridge.contexts.length > 1}
				<div>
					<span class="block text-sm font-medium text-n-700 mb-1">Feed type</span>
					<div class="flex flex-wrap gap-1.5">
						{#each bridge.contexts as context (context.name)}
							<button
								type="button"
								onclick={() => (contextName = context.name)}
								class={`rounded-md border px-2.5 py-1 text-xs ${
									contextName === context.name
										? 'border-a-600 bg-a-600 text-on-accent'
										: 'border-n-300 text-n-600 hover:bg-n-100'
								}`}
							>
								{context.name}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Param ids are namespaced: five bridges (InstructablesBridge, NintendoBridge…) have a
			     param literally named `category`, which would otherwise collide with this wizard's own
			     `bwiz-category` picker and point both "Category" labels at the same element. -->
			{#each currentContext?.params ?? [] as param (contextName + '/' + param.name)}
				<div>
					<label for={`bwiz-param-${param.name}`} class="block text-sm font-medium text-n-700 mb-1">
						{param.label}{#if param.required}<span class="text-danger"> *</span>{/if}
					</label>

					{#if param.type === 'list'}
						<select
							id={`bwiz-param-${param.name}`}
							bind:value={values[param.name]}
							class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						>
							<!-- Options are deliberately unkeyed: upstream keys `values` by label, so two labels
							     can share one value (InstructablesBridge lists "/makeymakey/" under the same
							     group twice) and a value-keyed each throws each_key_duplicate — in prod too.
							     The list is static, so index keying is right anyway. -->
							{#each groupsOf(param) as group (group.group)}
								{#if group.group}
									<optgroup label={group.group}>
										{#each group.options as option}
											<option value={option.value}>{option.label}</option>
										{/each}
									</optgroup>
								{:else}
									{#each group.options as option}
										<option value={option.value}>{option.label}</option>
									{/each}
								{/if}
							{/each}
						</select>
					{:else if param.type === 'checkbox'}
						<div class="flex items-center gap-2">
							<input
								id={`bwiz-param-${param.name}`}
								type="checkbox"
								bind:checked={values[param.name] as boolean}
								class="rounded border-n-300"
							/>
							{#if param.title}<span class="text-xs text-n-500">{param.title}</span>{/if}
						</div>
					{:else if param.type === 'number'}
						<!-- Not bind:value: Svelte coerces a number input to number|null, which would put a
						     non-string into `values` and break the String(...).trim() above. -->
						<input
							id={`bwiz-param-${param.name}`}
							type="number"
							value={values[param.name]}
							oninput={(e) => (values[param.name] = e.currentTarget.value)}
							placeholder={param.exampleValue ?? ''}
							class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						/>
					{:else}
						<input
							id={`bwiz-param-${param.name}`}
							type="text"
							bind:value={values[param.name] as string}
							spellcheck="false"
							placeholder={param.exampleValue ?? ''}
							class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						/>
					{/if}

					{#if param.title && param.type !== 'checkbox'}
						<p class="mt-1 text-xs text-n-500">{param.title}</p>
					{/if}
				</div>
			{/each}
			{:else}
				<div class="rounded-md border border-n-200 bg-n-50 px-3 py-2.5">
					<dl class="space-y-1 text-sm">
						{#each detectedSummary as row (row.label)}
							<div class="flex gap-2">
								<dt class="shrink-0 text-n-500">{row.label}:</dt>
								<dd class="min-w-0 break-words font-medium text-n-800">{row.value}</dd>
							</div>
						{/each}
					</dl>
					<button
						type="button"
						onclick={() => (formOpen = true)}
						class="mt-2 text-xs text-a-600 underline hover:text-a-700"
					>
						Edit parameters
					</button>
				</div>
			{/if}

			<div>
				<label for="bwiz-category" class="block text-sm font-medium text-n-700 mb-1">Category</label>
				<CategorySelect id="bwiz-category" bind:value={categoryId} bind:newName={newCategoryName} />
			</div>

			<div class="flex items-center gap-2">
				<input id="bwiz-crawler" type="checkbox" bind:checked={crawler} class="rounded border-n-300" />
				<label for="bwiz-crawler" class="text-sm text-n-700">
					Fetch original content (crawler) — usually unnecessary, this bridge returns real content
				</label>
			</div>

			{#if bridgeUrl && !detecting}
				<div class="space-y-2">
					<label for="bwiz-bridge-url" class="block text-sm font-medium text-n-700">Feed URL</label>
					<div class="flex gap-2">
						<input
							id="bwiz-bridge-url"
							type="url"
							value={bridgeUrl}
							readonly
							class="min-w-0 flex-1 rounded-md border border-n-200 bg-n-50 px-3 py-2 font-mono text-xs text-n-500 focus:outline-none"
						/>
						<button
							type="button"
							onclick={copyUrl}
							title="Copy URL"
							class="shrink-0 rounded-md border border-n-300 p-2 text-n-600 hover:bg-n-100"
						>
							{#if copied}<Check class="h-4 w-4 text-success" />{:else}<Copy class="h-4 w-4" />{/if}
						</button>
						<button
							type="button"
							onclick={testBridge}
							disabled={testing || detecting || missingRequired}
							class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-n-300 px-3 py-2 text-sm text-n-700 hover:bg-n-100 disabled:opacity-50"
						>
							<FlaskConical class={`h-3.5 w-3.5 ${testing ? 'animate-pulse' : ''}`} />
							{testing ? 'Testing…' : 'Test'}
						</button>
					</div>
					{#if testCurrent}
						<p class={`text-xs ${testCurrent.ok ? 'text-success' : 'text-danger'}`}>
							{testCurrent.message}
						</p>
					{/if}
				</div>
			{/if}
		</div>

		<div class="flex justify-end gap-2 border-t border-n-200 px-5 py-4">
			<button
				type="button"
				onclick={onclose}
				class="px-4 py-2 text-sm text-n-600 hover:bg-n-100 rounded-md"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={handleCreate}
				disabled={saving || testing || detecting || !bridgeUrl || missingRequired || (categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim())}
				class="px-4 py-2 text-sm bg-a-600 text-on-accent rounded-md hover:bg-a-700 disabled:opacity-50"
			>
				{saving
					? 'Creating…'
					: testing
						? 'Testing…'
						: testCurrent && !testCurrent.ok
							? 'Create anyway'
							: 'Create feed'}
			</button>
		</div>
	</div>
</div>
