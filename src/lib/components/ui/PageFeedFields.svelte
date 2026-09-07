<script lang="ts">
	import { PAGE_FEED_LIMIT_MAX, type PageFeedConfig } from '$lib/pageFeed';

	// The selector/pattern/limit part of a page-feed config, shared by the creation wizard and the
	// Feed Settings section. The page URL is the caller's — it has its own load/reload flow.
	let {
		config = $bindable(),
		disabled = false,
		idPrefix = 'pf'
	}: {
		config: PageFeedConfig;
		disabled?: boolean;
		idPrefix?: string;
	} = $props();

	// number inputs bind to null/NaN when cleared; the config wants a positive integer or nothing.
	function setLimit(e: Event) {
		const value = Number((e.currentTarget as HTMLInputElement).value);
		config.limit = Number.isInteger(value) && value > 0 ? Math.min(value, PAGE_FEED_LIMIT_MAX) : undefined;
	}

	const inputClass =
		'w-full rounded-md border border-n-300 px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50';
</script>

<div class="space-y-3">
	<div>
		<label for="{idPrefix}-selector" class="mb-1 block text-sm font-medium text-n-700">Item selector</label>
		<input
			id="{idPrefix}-selector"
			type="text"
			bind:value={config.itemSelector}
			{disabled}
			spellcheck="false"
			placeholder="article"
			class="w-full rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
		/>
		<p class="mt-1 text-xs text-n-500">
			CSS selector for one listed item — the card, row or title link. The link, title, date,
			summary and image are read from around it.
		</p>
	</div>

	<details class="rounded-md border border-n-200">
		<summary class="cursor-pointer select-none px-3 py-2 text-sm text-n-600">Advanced</summary>
		<div class="grid gap-3 border-t border-n-100 px-3 py-3 sm:grid-cols-2">
			<div>
				<label for="{idPrefix}-pattern" class="mb-1 block text-xs font-medium text-n-600">
					Link pattern (regex)
				</label>
				<input
					id="{idPrefix}-pattern"
					type="text"
					bind:value={config.urlPattern}
					{disabled}
					spellcheck="false"
					placeholder="/news/"
					class={inputClass}
				/>
			</div>
			<div>
				<label for="{idPrefix}-limit" class="mb-1 block text-xs font-medium text-n-600">Max items</label>
				<input
					id="{idPrefix}-limit"
					type="number"
					value={config.limit ?? ''}
					oninput={setLimit}
					{disabled}
					min="1"
					max={PAGE_FEED_LIMIT_MAX}
					placeholder="50"
					class={inputClass}
				/>
			</div>
			<div>
				<label for="{idPrefix}-title" class="mb-1 block text-xs font-medium text-n-600">Title selector</label>
				<input
					id="{idPrefix}-title"
					type="text"
					bind:value={config.titleSelector}
					{disabled}
					spellcheck="false"
					placeholder="auto: first heading"
					class={inputClass}
				/>
			</div>
			<div>
				<label for="{idPrefix}-date" class="mb-1 block text-xs font-medium text-n-600">Date selector</label>
				<input
					id="{idPrefix}-date"
					type="text"
					bind:value={config.dateSelector}
					{disabled}
					spellcheck="false"
					placeholder="auto: time[datetime]"
					class={inputClass}
				/>
			</div>
			<div>
				<label for="{idPrefix}-summary" class="mb-1 block text-xs font-medium text-n-600">
					Summary selector
				</label>
				<input
					id="{idPrefix}-summary"
					type="text"
					bind:value={config.summarySelector}
					{disabled}
					spellcheck="false"
					placeholder="auto: standfirst paragraph"
					class={inputClass}
				/>
			</div>
			<div>
				<label for="{idPrefix}-image" class="mb-1 block text-xs font-medium text-n-600">Image selector</label>
				<input
					id="{idPrefix}-image"
					type="text"
					bind:value={config.imageSelector}
					{disabled}
					spellcheck="false"
					placeholder="auto: first img"
					class={inputClass}
				/>
			</div>
		</div>
		<p class="px-3 pb-3 text-xs text-n-500">
			Selectors are relative to each item. Leave empty to keep the automatic choice.
		</p>
	</details>
</div>
