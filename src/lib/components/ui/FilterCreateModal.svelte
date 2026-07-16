<script lang="ts">
	import type { FilterSeed } from '$lib/stores/ui.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import {
		appendFieldRule,
		rulePattern,
		suggestFilterPhrase,
		toJsRegex,
		FILTER_FIELDS,
		type FilterField
	} from '$lib/contentFilter';
	import { loadFilterAction, appendHideRule } from '$lib/filterHide';
	import { Ban } from 'lucide-svelte';

	let { seed }: { seed: FilterSeed } = $props();

	// svelte-ignore state_referenced_locally
	let phrase = $state(suggestFilterPhrase(seed.seedTitle));
	let field = $state<FilterField>('title');
	let hideExisting = $state(true);
	let saving = $state(false);

	function onclose() {
		ui.closeFilterModal();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	async function handleConfirm() {
		const term = phrase.trim();
		if (!term) return;
		saving = true;
		try {
			// Honour the feed's filter action: 'mark-read' keeps the rule client-side (localStorage),
			// 'block' writes a Miniflux server rule. Either way we can hide already-downloaded matches.
			if (loadFilterAction(seed.feedId) === 'mark-read') {
				appendHideRule(seed.feedId, { list: 'block', field, mode: 'contains', value: term });
			} else {
				const feed = feeds.getRawFeed(seed.feedId);
				const updated = appendFieldRule(feed?.block_filter_entry_rules ?? '', field, term);
				await feeds.updateFeed(seed.feedId, { block_filter_entry_rules: updated });
			}

			let hidden = 0;
			if (hideExisting)
				hidden = await entries.blockExistingMatches(
					seed.feedId,
					field,
					toJsRegex(rulePattern('contains', term))
				);
			ui.showSuccess(
				hidden > 0
					? `Filter added — hid ${hidden} existing ${hidden === 1 ? 'post' : 'posts'}.`
					: 'Filter added.'
			);
			onclose();
		} catch {
			// Error surfaced by the store
		} finally {
			saving = false;
		}
	}
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-40 bg-overlay/30" onclick={onclose}></div>

<div class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
	<div class="bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 pointer-events-auto">
		<div class="px-5 py-4 border-b border-n-200 flex items-center gap-2">
			<Ban class="size-5 text-n-500" />
			<h2 class="text-lg font-semibold text-n-800">Ignore posts like this</h2>
		</div>

		<form onsubmit={(e) => { e.preventDefault(); handleConfirm(); }} class="px-5 py-4 space-y-4">
			<div>
				<div class="mb-1 block text-sm font-medium text-n-700">
					Ignore new posts in <span class="font-semibold">{seed.feedTitle}</span> where
				</div>
				<div class="flex items-center gap-2">
					<select
						bind:value={field}
						aria-label="Field to match"
						class="shrink-0 rounded-md border border-n-300 bg-surface px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					>
						{#each FILTER_FIELDS as f (f.value)}
							<option value={f.value}>{f.label}</option>
						{/each}
					</select>
					<span class="shrink-0 text-sm text-n-600">contains</span>
					<input
						id="filter-phrase"
						type="text"
						bind:value={phrase}
						spellcheck="false"
						class="min-w-0 flex-1 px-3 py-2 border border-n-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
					/>
				</div>
				<p class="mt-1 text-xs text-n-500">
					Case-insensitive. Matches only the selected field. Manage all filters in the feed's settings.
				</p>
			</div>

			<label class="flex items-center gap-2 text-sm text-n-700">
				<input type="checkbox" bind:checked={hideExisting} class="rounded border-n-300" />
				Also hide already-downloaded posts that match
			</label>

			<div class="flex justify-end gap-2 pt-2">
				<button
					type="button"
					onclick={onclose}
					class="px-4 py-2 text-sm text-n-600 hover:bg-n-100 rounded-md"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={saving || phrase.trim() === ''}
					class="px-4 py-2 text-sm bg-a-600 text-on-accent rounded-md hover:bg-a-700 disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Ignore posts'}
				</button>
			</div>
		</form>
	</div>
</div>
