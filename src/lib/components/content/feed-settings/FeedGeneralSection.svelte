<script lang="ts">
	import type { Feed } from '$lib/types';
	import { AlertTriangle } from 'lucide-svelte';
	import { relaTimestamp } from '$lib/time';
	import { normalizeLang } from '$lib/lang';
	import CategorySelect from '$lib/components/ui/CategorySelect.svelte';

	let {
		active,
		feed,
		entryCount,
		title = $bindable(),
		categoryId = $bindable(),
		newCategoryName = $bindable(),
		siteUrl = $bindable(),
		rssSourceUrl = $bindable(),
		rssEnabled,
		effectiveFeedUrl
	}: {
		active: boolean;
		feed: Feed;
		entryCount: number | null;
		title: string;
		categoryId: number;
		newCategoryName: string;
		siteUrl: string;
		rssSourceUrl: string;
		rssEnabled: boolean;
		effectiveFeedUrl: string;
	} = $props();

	// Shown, not edited: Miniflux reads this from the feed itself (2.3.3+) and its API has no
	// field to override it. It earns the row by explaining why this feed's articles do or don't
	// carry a lang attribute — and an empty value doubles as "not re-parsed since the upgrade".
	const language = $derived(normalizeLang(feed.language));
	const languageHint = $derived(
		language
			? 'Declared by the feed. Its titles and article text are tagged with this language, so screen readers, hyphenation and translation offers follow it.'
			: 'Not declared by the feed — or the feed has not been re-parsed since Miniflux 2.3.3, which is the first version to read it. Its text keeps the page language.'
	);
</script>

<section class:hidden={!active} class="rounded-lg border border-n-100 bg-surface p-5 shadow-xl">
	<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">General</h3>

	<!-- Stats -->
	<div class="flex gap-5 mb-4">
	  <div><span class="font-semibold text-n-500 uppercase text-xs">Last refresh:</span> <span class="" title={feed.checked_at ?? ''}>{feed.checked_at ? `${relaTimestamp(feed.checked_at)} ago` : '—'}</span></div>
	  <div><span class="font-semibold text-n-500 uppercase text-xs">Total entries:</span> <span class="text-n-800">{entryCount ?? '—'}</span></div>
	  <div title={languageHint}><span class="font-semibold text-n-500 uppercase text-xs">Language:</span> <span class="text-n-800">{language ?? '—'}</span></div>
	</div>
	{#if feed.parsing_error_count && feed.parsing_error_count > 0}
		<div class="text-danger mb-4 bg-danger/10 border border-danger rounded px-4 py-2">
			<p class="flex items-center gap-1.5 ">
				<AlertTriangle class="h-4 w-4 shrink-0" />
				<span class="">Parsing errors</span>
  			  <span class="">{feed.parsing_error_count}×</span>
			</p>
				{#if feed.parsing_error_message}
					<p class="text-sm mt-1">{feed.parsing_error_message}</p>
				{/if}
		</div>
	{/if}

	<div class="space-y-4 pb-2">
      <div class="flex gap-4 flex-wrap">
			<div class="w-full lg:w-2/3">
				<label for="feed-title" class="mb-1 block text-sm font-medium text-n-700">Title</label>
				<input
					id="feed-title"
					type="text"
					bind:value={title}
					class="w-full rounded-md border border-n-300 px-3 py-2 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
			</div>
			<div class="grow">
				<label for="feed-category" class="mb-1 block text-sm font-medium text-n-700">Category</label>
				<CategorySelect
					id="feed-category"
					bind:value={categoryId}
					bind:newName={newCategoryName}
					selectClass="w-full text-base rounded-md border border-n-300 bg-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-n-400"
					inputClass="mt-2 w-full text-base rounded-md border border-n-300 bg-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
			</div>
		</div>

		<div>
			<label for="feed-feed-url" class="mb-1 block text-sm font-medium text-n-700">Feed URL</label>
			{#if rssEnabled}
				<input
					id="feed-feed-url"
					type="url"
					value={effectiveFeedUrl}
					readonly
					class="w-full rounded-md border border-n-200 bg-n-50 px-3 py-2 text-sm text-n-500 focus:outline-none"
				/>
				<p class="mt-1 text-xs text-n-500">
					Managed by RSS-Bridge — edit the parameters below, or disable it to set a direct URL.
				</p>
			{:else}
				<input
					id="feed-feed-url"
					type="url"
					bind:value={rssSourceUrl}
					class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
				/>
			{/if}
		</div>
		<div>
 					<label for="feed-site-url" class="mb-1 block text-sm font-medium text-n-700">Site URL</label>
 					<input
						id="feed-site-url"
						type="url"
						bind:value={siteUrl}
						class="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
 					/>
		</div>



	</div>


</section>
