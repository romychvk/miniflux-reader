<script lang="ts">
	import { Copy, Check, FlaskConical } from 'lucide-svelte';
	import type { FeedCreate } from '$lib/types';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { NEW_CATEGORY_SENTINEL } from '$lib/category';
	import CategorySelect from './CategorySelect.svelte';
	import { storageSet } from '$lib/storage';
	import { buildRssBridgeUrl, RSS_BRIDGE_INSTANCE_KEY, type RssBridgeParam } from '$lib/rssbridge';
	import { countBridgeEntries, bridgeErrorMessage } from '$lib/scrapedFeed';
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
		// What the user typed in Add Feed. Shown for context only — deriving parameters from it
		// (band = subdomain…) is bridge-specific guesswork that doesn't generalise, so we don't.
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

	let testing = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);
	let testedUrl = $state('');
	let saving = $state(false);
	let copied = $state(false);

	const currentContext = $derived(bridge.contexts.find((c) => c.name === contextName));

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
		let result: { ok: boolean; message: string };
		try {
			const res = await fetch(`/api/fetch-page?url=${encodeURIComponent(target)}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				result = {
					ok: false,
					message: `${data?.error || `Bridge request failed (${res.status})`}. Is ${bridge.key} in your instance's enabled_bridges?`
				};
			} else {
				const body = data?.html ?? '';
				const { isFeed, entries } = countBridgeEntries(body);
				const bridgeError = bridgeErrorMessage(body);
				if (bridgeError) {
					result = { ok: false, message: `${bridgeError} — check the values below.` };
				} else if (!isFeed) {
					result = {
						ok: false,
						message: `The response is not a feed — is ${bridge.key} in your instance's enabled_bridges?`
					};
				} else if (entries === 0) {
					result = { ok: false, message: 'The bridge responded but returned no items.' };
				} else {
					result = { ok: true, message: `The bridge returned ${entries} item${entries === 1 ? '' : 's'}.` };
				}
			}
		} catch {
			result = { ok: false, message: 'Could not reach the bridge.' };
		} finally {
			testing = false;
		}
		testResult = result;
		testedUrl = target;
		return result.ok;
	}

	async function handleCreate() {
		if (!bridgeUrl || saving || testing || missingRequired) return;
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
					A ready-made bridge for <span class="font-medium text-n-600">{bridge.host}</span>, from
					{instance}. Fill in what it needs below — the values aren't guessed from
					<span class="font-mono">{sourceUrl}</span>.
				</p>
			{/if}

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

			{#each currentContext?.params ?? [] as param (contextName + '/' + param.name)}
				<div>
					<label for={`bwiz-${param.name}`} class="block text-sm font-medium text-n-700 mb-1">
						{param.label}{#if param.required}<span class="text-danger"> *</span>{/if}
					</label>

					{#if param.type === 'list'}
						<select
							id={`bwiz-${param.name}`}
							bind:value={values[param.name]}
							class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						>
							{#each groupsOf(param) as group (group.group)}
								{#if group.group}
									<optgroup label={group.group}>
										{#each group.options as option (option.value)}
											<option value={option.value}>{option.label}</option>
										{/each}
									</optgroup>
								{:else}
									{#each group.options as option (option.value)}
										<option value={option.value}>{option.label}</option>
									{/each}
								{/if}
							{/each}
						</select>
					{:else if param.type === 'checkbox'}
						<div class="flex items-center gap-2">
							<input
								id={`bwiz-${param.name}`}
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
							id={`bwiz-${param.name}`}
							type="number"
							value={values[param.name]}
							oninput={(e) => (values[param.name] = e.currentTarget.value)}
							placeholder={param.exampleValue ?? ''}
							class="w-full px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						/>
					{:else}
						<input
							id={`bwiz-${param.name}`}
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

			{#if bridgeUrl}
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
							disabled={testing || missingRequired}
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
				disabled={saving || testing || !bridgeUrl || missingRequired || (categoryId === NEW_CATEGORY_SENTINEL && !newCategoryName.trim())}
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
