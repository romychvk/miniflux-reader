<script lang="ts">
	import { PAGE_FEED_LIMIT_MAX, type PageFeedConfig, type PageFeedMode } from '$lib/pageFeed';

	// The selector/pattern/limit part of a page-feed config, shared by the creation wizard and the
	// Feed Settings section. The page URL is the caller's — it has its own load/reload flow.
	let {
		config = $bindable(),
		disabled = false,
		idPrefix = 'pf',
		onmodechange
	}: {
		config: PageFeedConfig;
		disabled?: boolean;
		idPrefix?: string;
		// The mode is handed up rather than written straight into the config: switching it makes the
		// current selector meaningless, so the caller reseeds and re-previews instead of watching an
		// `article` selector score zero sections.
		onmodechange?: (mode: PageFeedMode) => void;
	} = $props();

	const sections = $derived(config.mode === 'sections');

	const MODES: { value: PageFeedMode; label: string; hint: string }[] = [
		{ value: 'cards', label: 'Item cards', hint: 'Repeated linked cards — a tag page, a "latest" list' },
		{ value: 'sections', label: 'Document sections', hint: 'One long page split at its headings — release notes, a changelog' }
	];

	function pickMode(mode: PageFeedMode) {
		if (disabled || mode === (config.mode ?? 'cards')) return;
		onmodechange?.(mode);
	}

	// number inputs bind to null/NaN when cleared; the config wants a positive integer or nothing.
	function setLimit(e: Event) {
		const value = Number((e.currentTarget as HTMLInputElement).value);
		config.limit = Number.isInteger(value) && value > 0 ? Math.min(value, PAGE_FEED_LIMIT_MAX) : undefined;
	}

	const inputClass =
		'w-full rounded-md border border-n-300 px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50';
</script>

<div class="space-y-3">
	<div class="flex flex-wrap gap-2">
		{#each MODES as option (option.value)}
			<button
				type="button"
				onclick={() => pickMode(option.value)}
				{disabled}
				title={option.hint}
				class="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50 {(config.mode ?? 'cards') === option.value
					? 'border-n-400 bg-n-100 font-medium text-n-800'
					: 'border-n-200 text-n-600 hover:bg-n-50'}"
			>
				{option.label}
			</button>
		{/each}
	</div>

	<div>
		<label for="{idPrefix}-selector" class="mb-1 block text-sm font-medium text-n-700">
			{sections ? 'Heading selector' : 'Item selector'}
		</label>
		<input
			id="{idPrefix}-selector"
			type="text"
			bind:value={config.itemSelector}
			{disabled}
			spellcheck="false"
			placeholder={sections ? 'h2' : 'article'}
			class="w-full rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
		/>
		<p class="mt-1 text-xs text-n-500">
			{#if sections}
				CSS selector for the section headings. Each item is one heading plus everything after it
				up to the next match, and carries that section's own text.
			{:else}
				CSS selector for one listed item — the card, row or title link. The link, title, date,
				summary and image are read from around it.
			{/if}
		</p>
	</div>

	<details class="rounded-md border border-n-200">
		<summary class="cursor-pointer select-none px-3 py-2 text-sm text-n-600">Advanced</summary>
		<div class="grid gap-3 border-t border-n-100 px-3 py-3 sm:grid-cols-2">
			{#if !sections}
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
			{/if}
			<div>
				<label for="{idPrefix}-title-pattern" class="mb-1 block text-xs font-medium text-n-600">
					Title pattern (regex)
				</label>
				<input
					id="{idPrefix}-title-pattern"
					type="text"
					bind:value={config.titlePattern}
					{disabled}
					spellcheck="false"
					placeholder={sections ? '[(]version' : 'auto: every title'}
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
			{#if !sections}
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
			{/if}
		</div>
		<p class="px-3 pb-3 text-xs text-n-500">
			{#if sections}
				A section keeps its own markup, so it needs no image selector, and its link is the page
				itself — the two fields that would drive those are hidden here.
			{:else}
				Selectors are relative to each item. Leave empty to keep the automatic choice.
			{/if}
		</p>
	</details>
</div>
