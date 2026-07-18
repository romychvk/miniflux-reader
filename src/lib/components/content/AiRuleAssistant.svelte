<script lang="ts">
	import { Sparkles, RotateCw, Check, Undo2 } from 'lucide-svelte';
	import type { Entry, Feed, AiMessage, RuleSuggestion } from '$lib/types';
	import { apiCall, authedFetch } from '$lib/api';
	import { sanitizeHtml } from '$lib/sanitize';
	import { entries } from '$lib/stores/entries.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { aiConfig } from '$lib/stores/aiConfig.svelte';
	import { requestRules } from '$lib/ai/client';
	import { buildInitialUserMessage, buildRefineUserMessage } from '$lib/ai/prompt';
	import { applyRewriteRules, unsupportedFunctions } from '$lib/ai/rewrite';

	let {
		feed,
		crawler,
		currentScraper,
		currentRewrite,
		onapply
	}: {
		feed: Feed;
		crawler: boolean;
		currentScraper: string;
		currentRewrite: string;
		onapply: (rules: { scraper_rules: string; rewrite_rules: string; crawler: boolean }) => void;
	} = $props();

	interface Sample {
		id: number;
		title: string;
		url: string;
		before: string;
		after: string;
	}

	let loading = $state(false);
	let sampleCount = $state(1);
	let feedbackText = $state('');
	let messages: AiMessage[] = $state([]);
	let result = $state<RuleSuggestion | null>(null);
	let samples = $state<Sample[]>([]);
	let previewed = $state(false);

	// Saved feed rules captured the first time we mutate the feed, so Discard can restore them.
	let baseline: { scraper_rules: string; rewrite_rules: string; crawler: boolean } | null = null;

	// Functions in the proposed rewrite rules that the local (crawler-off) preview can't
	// simulate, so we can warn the preview is partial.
	const unsupported = $derived(
		!crawler && result ? unsupportedFunctions(result.rewrite_rules) : []
	);

	// Preview the "after". With the crawler ON we must persist the rules and re-scrape,
	// because Miniflux only applies *saved* rules during fetch-content (same mechanism as
	// "Re-fetch latest"). With the crawler OFF, Miniflux would just apply rewrite_rules to
	// the existing feed content; there is no API to compute that without re-scraping, so we
	// simulate it locally — instant, and it never mutates the feed.
	async function preview() {
		if (!result) return;
		if (crawler) {
			if (!baseline) {
				baseline = {
					scraper_rules: feed.scraper_rules ?? '',
					rewrite_rules: feed.rewrite_rules ?? '',
					crawler: feed.crawler ?? false
				};
			}
			await feeds.updateFeed(feed.id, {
				scraper_rules: result.scraper_rules,
				rewrite_rules: result.rewrite_rules,
				crawler: true
			});
			previewed = true;
			for (const s of samples) {
				const content = await entries.refetchContent(s.id);
				s.after = content ?? '(failed to fetch)';
			}
		} else {
			for (const s of samples) {
				s.after = applyRewriteRules(s.before, result.rewrite_rules);
			}
		}
	}

	async function runPass(refineFeedback?: string) {
		if (!aiConfig.isConfigured) {
			ui.showError('AI assistant is not configured. Set it up in Settings.');
			return;
		}
		loading = true;
		try {
			if (!refineFeedback) {
				const data = await apiCall<{ entries: Entry[] }>(
					`feeds/${feed.id}/entries?order=published_at&direction=desc&limit=${sampleCount}`
				);
				const list = data.entries || [];
				if (list.length === 0) {
					throw new Error('No entries to sample — try "Re-fetch latest" first.');
				}
				samples = list.map((e) => ({
					id: e.id,
					title: e.title,
					url: e.url,
					before: e.content || '',
					after: ''
				}));

				// Raw original page (for the "expand" case) — only needed when scraping.
				let rawPageHtml: string | undefined;
				if (crawler) {
					try {
						const r = await authedFetch(`/api/fetch-page?url=${encodeURIComponent(list[0].url)}`);
						if (r.ok) rawPageHtml = (await r.json())?.html;
					} catch {
						/* the assistant can still propose rewrite rules from the content */
					}
				}

				messages = [
					{
						role: 'user',
						content: buildInitialUserMessage({
							sampleContents: samples.map((s) => s.before),
							rawPageHtml,
							currentScraper,
							currentRewrite,
							mode: crawler ? 'original' : 'feed'
						})
					}
				];
			} else {
				messages = [...messages, { role: 'user', content: buildRefineUserMessage(refineFeedback) }];
			}

			const raw = await requestRules(messages);
			messages = [...messages, { role: 'assistant', content: JSON.stringify(raw) }];

			// An empty field means "leave this kind of rule unchanged", so carry forward
			// the rules currently in effect (the prior proposal, or the form's values).
			// With the crawler off, scraper_rules have no effect, so always keep the form's
			// current scraper value regardless of what the model returned.
			const prevScraper = result ? result.scraper_rules : currentScraper;
			const prevRewrite = result ? result.rewrite_rules : currentRewrite;
			result = {
				scraper_rules: crawler
					? raw.scraper_rules.trim()
						? raw.scraper_rules
						: prevScraper
					: currentScraper,
				rewrite_rules: raw.rewrite_rules.trim() ? raw.rewrite_rules : prevRewrite,
				explanation: raw.explanation
			};

			await preview();
		} catch (e) {
			ui.showError(e instanceof Error ? e.message : 'AI request failed');
		} finally {
			loading = false;
		}
	}

	function refine() {
		const fb = feedbackText.trim();
		if (!fb) return;
		feedbackText = '';
		runPass(fb);
	}

	async function apply() {
		if (!result) return;
		if (crawler) {
			// preview() already saved these rules to the feed.
			onapply({ scraper_rules: result.scraper_rules, rewrite_rules: result.rewrite_rules, crawler: true });
		} else {
			// The local preview never touched the feed, so persist the rewrite rules now.
			await feeds.updateFeed(feed.id, { rewrite_rules: result.rewrite_rules });
			onapply({ scraper_rules: currentScraper, rewrite_rules: result.rewrite_rules, crawler: false });
		}
		ui.showSuccess('Rules applied. They are saved to the feed.');
	}

	function reset() {
		result = null;
		samples = [];
		messages = [];
		previewed = false;
		baseline = null;
		feedbackText = '';
	}

	async function discard() {
		if (baseline) {
			await feeds.updateFeed(feed.id, {
				scraper_rules: baseline.scraper_rules,
				rewrite_rules: baseline.rewrite_rules,
				crawler: baseline.crawler
			});
			onapply({
				scraper_rules: baseline.scraper_rules,
				rewrite_rules: baseline.rewrite_rules,
				crawler: baseline.crawler
			});
		}
		reset();
		ui.showSuccess('Reverted to the saved rules.');
	}
</script>

<div class="rounded-md border border-a-200 bg-a-50/40 p-4">
	<div class="mb-2 flex items-center gap-1.5">
		<Sparkles class="h-4 w-4 text-a-600" />
		<h4 class="text-sm font-semibold text-n-800">AI rule assistant</h4>
	</div>

	{#if !aiConfig.isConfigured}
		<p class="text-sm text-n-600">
			Connect an AI provider in
			<a href="/settings" class="text-a-600 underline hover:text-a-700">Settings</a>
			to let it suggest scraper &amp; rewrite rules.
		</p>
	{:else}
		<p class="mb-3 text-xs text-n-500">
			{#if crawler}
				Samples the latest entries, proposes scraper &amp; rewrite rules, and previews the
				result by saving them to the feed and re-fetching the samples.
			{:else}
				Samples the latest entries and proposes rewrite rules to clean up the existing feed
				content. The before/after is previewed locally — nothing is saved until you apply.
			{/if}
		</p>

		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onclick={() => runPass()}
				disabled={loading}
				class="inline-flex items-center gap-1.5 rounded-md bg-a-600 px-3 py-1.5 text-sm text-on-accent hover:bg-a-700 disabled:opacity-50"
			>
				<Sparkles class={`h-3.5 w-3.5 ${loading ? 'animate-pulse' : ''}`} />
				{loading ? 'Working…' : result ? 'Suggest again' : 'Suggest rules'}
			</button>
			<label class="flex items-center gap-1.5 text-sm text-n-600">
				on
				<input
					type="number"
					bind:value={sampleCount}
					min="1"
					max="3"
					disabled={loading}
					class="w-12 rounded-md border border-n-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
				/>
				sample(s)
			</label>
		</div>

		{#if result}
			<div class="mt-4 space-y-3">
				<!-- Proposed rules -->
				<div class={`grid gap-3 ${crawler ? 'sm:grid-cols-2' : ''}`}>
					{#if crawler}
						<div>
							<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-n-500">
								scraper_rules
							</div>
							<pre class="overflow-x-auto rounded border border-n-200 bg-surface px-2 py-1.5 font-mono text-xs text-n-800">{result.scraper_rules || '(none)'}</pre>
						</div>
					{/if}
					<div>
						<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-n-500">
							rewrite_rules
						</div>
						<pre class="overflow-x-auto rounded border border-n-200 bg-surface px-2 py-1.5 font-mono text-xs text-n-800">{result.rewrite_rules || '(none)'}</pre>
					</div>
				</div>

				{#if result.explanation}
					<p class="text-sm text-n-700">{result.explanation}</p>
				{/if}

				<!-- Before / after preview -->
				{#each samples as s (s.id)}
					<div class="rounded border border-n-200 bg-surface">
						<div class="border-b border-n-100 px-3 py-1.5 text-xs font-medium text-n-600 truncate">
							{s.title}
						</div>
						<div class="grid gap-px sm:grid-cols-2">
							<div class="min-w-0">
								<div class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-n-400">
									Before
								</div>
								<div class="max-h-64 overflow-y-auto px-3 pb-3">
									<article class="prose prose-sm max-w-none break-words">
										{@html sanitizeHtml(s.before)}
									</article>
								</div>
							</div>
							<div class="min-w-0 sm:border-l sm:border-n-100">
								<div class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-a-600">
									After
								</div>
								<div class="max-h-64 overflow-y-auto px-3 pb-3">
									<article class="prose prose-sm max-w-none break-words">
										{@html sanitizeHtml(s.after)}
									</article>
								</div>
							</div>
						</div>
					</div>
				{/each}

				{#if !crawler}
					<p class="text-xs text-n-500">
						Preview is simulated in your browser, so the live result may differ slightly
						from Miniflux's stricter CSS engine. Saved rules apply to entries fetched from
							here on.{#if unsupported.length}
							Not shown in preview: {unsupported.join(', ')}.{/if}
					</p>
				{/if}

				<!-- Refine -->
				<div>
					<label for="ai-feedback" class="mb-1 block text-sm font-medium text-n-700">
						What to fix?
					</label>
					<div class="flex gap-2">
						<input
							id="ai-feedback"
							type="text"
							bind:value={feedbackText}
							disabled={loading}
							onkeydown={(e) => e.key === 'Enter' && refine()}
							placeholder="e.g. also remove the “Read also” block, keep the images"
							class="min-w-0 flex-1 rounded-md border border-n-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 disabled:opacity-50"
						/>
						<button
							type="button"
							onclick={refine}
							disabled={loading || !feedbackText.trim()}
							class="inline-flex items-center gap-1.5 rounded-md border border-n-300 px-3 py-1.5 text-sm text-n-700 hover:bg-n-100 disabled:opacity-50"
						>
							<RotateCw class={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
							Refine
						</button>
					</div>
				</div>

				<!-- Apply / discard -->
				<div class="flex flex-wrap items-center gap-2 border-t border-n-100 pt-3">
					<button
						type="button"
						onclick={apply}
						disabled={loading}
						class="inline-flex items-center gap-1.5 rounded-md bg-a-600 px-3 py-1.5 text-sm text-on-accent hover:bg-a-700 disabled:opacity-50"
					>
						<Check class="h-3.5 w-3.5" />
						Apply to fields
					</button>
					{#if previewed}
						<button
							type="button"
							onclick={discard}
							disabled={loading}
							class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-n-600 hover:bg-n-100 disabled:opacity-50"
						>
							<Undo2 class="h-3.5 w-3.5" />
							Discard
						</button>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>
