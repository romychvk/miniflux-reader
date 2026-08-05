<script lang="ts">
	import { Plus, X } from 'lucide-svelte';
	import type { RssBridgeParam } from '$lib/rssbridge';

	let {
		active,
		rssEnabled = $bindable(),
		rssInstance = $bindable(),
		rssBridge = $bindable(),
		rssSourceUrl = $bindable(),
		rssParams = $bindable(),
		rssSourceKey
	}: {
		active: boolean;
		rssEnabled: boolean;
		rssInstance: string;
		rssBridge: string;
		rssSourceUrl: string;
		rssParams: RssBridgeParam[];
		rssSourceKey: string;
	} = $props();

	function addRssParam() {
		rssParams = [...rssParams, { key: '', value: '' }];
	}
	function removeRssParam(i: number) {
		rssParams = rssParams.filter((_, idx) => idx !== i);
	}
</script>

<section class:hidden={!active} class="rounded-lg border border-n-100 bg-surface p-5 shadow-xl">
	<div class="mb-4 flex items-center justify-between">
		<h3 class="text-sm font-semibold uppercase tracking-wide text-n-500">RSS-Bridge</h3>
		<label class="flex items-center gap-2 text-sm text-n-700">
			<input type="checkbox" bind:checked={rssEnabled} class="rounded border-n-300" />
			Enabled
		</label>
	</div>

	<p class="mb-4 text-xs text-n-500">
		Route this feed through an RSS-Bridge instance. When disabled, the parameters are kept but
		the feed uses the direct Source URL (shown in General). Save, then refresh the feed to
		re-pull entries from the new URL.
	</p>

	<div class={`space-y-4 transition-opacity ${rssEnabled ? '' : 'pointer-events-none opacity-50'}`}>
		<div class="flex flex-wrap gap-4">
			<div class="grow">
				<label for="rss-instance" class="mb-1 block text-sm font-medium text-n-700">Instance</label>
				<input
					id="rss-instance"
					type="url"
					bind:value={rssInstance}
					disabled={!rssEnabled}
					placeholder="https://your-rssbridge-instance/"
					class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
				/>
			</div>
			<div class="grow">
				<label for="rss-bridge-name" class="mb-1 block text-sm font-medium text-n-700">Bridge</label>
				<input
					id="rss-bridge-name"
					type="text"
					bind:value={rssBridge}
					disabled={!rssEnabled}
					placeholder="FilterBridge"
					class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
				/>
			</div>
		</div>

		<div>
			<label for="rss-source" class="mb-1 block text-sm font-medium text-n-700">Source URL</label>
			<input
				id="rss-source"
				type="url"
				bind:value={rssSourceUrl}
				disabled={!rssEnabled}
				placeholder="https://example.com/feed.atom"
				class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
			/>
			<p class="mt-1 text-xs text-n-500">
				{#if rssSourceKey === 'home_page'}
					The page the bridge scrapes (the <code>home_page</code> parameter).
				{:else}
					The underlying feed the bridge wraps (the <code>url</code> parameter).
				{/if}
			</p>
		</div>

		<div>
			<div class="mb-1 flex items-center justify-between">
				<span class="text-sm font-medium text-n-700">Parameters</span>
				<button
					type="button"
					onclick={addRssParam}
					disabled={!rssEnabled}
					class="inline-flex items-center gap-1 rounded-md border border-n-300 px-2 py-1 text-xs text-n-700 hover:bg-n-100 disabled:opacity-50"
				>
					<Plus class="h-3.5 w-3.5" /> Add parameter
				</button>
			</div>
			<div class="space-y-2">
				{#each rssParams as param, i (i)}
					<div class="flex items-center gap-2">
						<input
							type="text"
							bind:value={param.key}
							disabled={!rssEnabled}
							placeholder="filter_type"
							class="w-40 rounded-md border border-n-300 px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
						/>
						<input
							type="text"
							bind:value={param.value}
							disabled={!rssEnabled}
							placeholder="block"
							class="min-w-0 flex-1 rounded-md border border-n-300 px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
						/>
						<button
							type="button"
							onclick={() => removeRssParam(i)}
							disabled={!rssEnabled}
							title="Remove parameter"
							class="shrink-0 rounded-md p-1.5 text-n-400 hover:bg-n-100 hover:text-n-700 disabled:opacity-50"
						>
							<X class="h-4 w-4" />
						</button>
					</div>
				{/each}
				{#if rssParams.length === 0}
					<p class="text-xs text-n-400">No parameters.</p>
				{/if}
			</div>
		</div>
	</div>
</section>
