<script lang="ts">
	import type { Feed } from '$lib/types';
	import { ExternalLink, RotateCw } from 'lucide-svelte';
	import AiRuleAssistant from '../AiRuleAssistant.svelte';

	let {
		active,
		feed,
		crawler = $bindable(),
		scraperRules = $bindable(),
		rewriteRules = $bindable(),
		refetchCount = $bindable(),
		refetchStatus = $bindable(),
		refetching,
		progress,
		onRefetch,
		onApplyAiRules
	}: {
		active: boolean;
		feed: Feed;
		crawler: boolean;
		scraperRules: string;
		rewriteRules: string;
		refetchCount: number;
		refetchStatus: 'unread' | 'all';
		refetching: boolean;
		progress: { done: number; total: number };
		onRefetch: () => void;
		onApplyAiRules: (rules: { scraper_rules: string; rewrite_rules: string; crawler: boolean }) => void;
	} = $props();
</script>

<section class:hidden={!active} class="rounded-lg border border-n-100 shadow-xl bg-surface p-5">
	<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Original Content</h3>
	<div class="flex flex-col xl:flex-row gap-4 items-start">
		<div class="flex items-center gap-2 xl:w-1/2">
			<input id="feed-crawler" type="checkbox" bind:checked={crawler} class="rounded border-n-300" />
			<label for="feed-crawler" class="text-sm text-n-700">Fetch original content (crawler)</label>
		</div>
		<div class="grow mb-4 xl:mb-2 xl:min-w-96">
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={onRefetch}
					disabled={refetching || !crawler}
					class="inline-flex items-center gap-1.5 rounded-md border border-n-300 px-3 py-1.5 text-sm hover:bg-n-700 bg-n-600 disabled:opacity-50 text-n-50"
				>
					<RotateCw class={`h-3.5 w-3.5 ${refetching ? 'animate-spin' : ''}`} />
					{refetching ? `Re-fetching ${progress.done}/${progress.total}…` : 'Re-fetch latest'}
				</button>
				<input
					type="number"
					bind:value={refetchCount}
					min="1"
					max="100"
					disabled={refetching || !crawler}
					class="w-14 rounded-md border border-n-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
				/>
				<div>
  						<select
  							bind:value={refetchStatus}
  							disabled={refetching || !crawler}
  							class="rounded-md border border-n-300 bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
  						>
  							<option value="unread">unread</option>
  							<option value="all">all</option>
  						</select>
  						<span class="text-sm text-n-600">entries</span>
				</div>
			</div>
			<p class="mt-1 text-xs text-n-500">Saves changes, then re-applies the rules to the latest entries already downloaded.</p>
		</div>

	</div>
	<div class="space-y-3">


		<div class={`transition-opacity ${crawler ? '' : 'pointer-events-none opacity-50'}`}>
			<div>
				<label for="feed-scraper" class="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-700">
					Scraper Rules
					<a
						href="https://miniflux.app/docs/rules.html#scraper-rules"
						target="_blank"
						rel="noopener noreferrer"
						title="Miniflux documentation"
						class="text-a-600 hover:text-a-700"
					>
						<ExternalLink class="h-3.5 w-3.5" />
					</a>
				</label>
				<textarea
					id="feed-scraper"
					bind:value={scraperRules}
					rows="2"
					spellcheck="false"
					disabled={!crawler}
					placeholder='article, div[itemprop="articleBody"]'
					class="w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
				></textarea>
				<p class="mt-1 text-xs text-n-500">CSS selector for the main content. Comma-separated for multiple. Only used when the crawler is on.</p>
			</div>
		</div>

		<div>
			<label for="feed-rewrite" class="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-700">
				Content Rewrite Rules
				<a
					href="https://miniflux.app/docs/rules.html#rewrite-rules"
					target="_blank"
					rel="noopener noreferrer"
					title="Miniflux documentation"
					class="text-a-600 hover:text-a-700"
				>
					<ExternalLink class="h-3.5 w-3.5" />
				</a>
			</label>
			<textarea
				id="feed-rewrite"
				bind:value={rewriteRules}
				rows="2"
				spellcheck="false"
				placeholder='remove(".ads, #promo")'
				class="w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
			></textarea>
			<p class="mt-1 text-xs text-n-500">Cleanup functions, e.g. remove("…"), replace("a"|"b"). Applied to both fetched and default feed content.</p>
		</div>

		<AiRuleAssistant
			{feed}
			{crawler}
			currentScraper={scraperRules}
			currentRewrite={rewriteRules}
			onapply={onApplyAiRules}
		/>
	</div>
</section>
