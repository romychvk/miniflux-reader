<script lang="ts">
	import type { FeedUpdate } from '$lib/types';
	import { ui } from '$lib/stores/ui.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { storageGetString, storageSet } from '$lib/storage';
	import { ListFilter, ExternalLink, X, Plus } from 'lucide-svelte';
	import {
		DEDUP_STORAGE_PREFIX,
		DEDUP_OPTIONS,
		asDedupMode,
		type DedupMode
	} from '$lib/dedup';
	import {
		parseRules,
		compileRules,
		FILTER_FIELDS,
		type FilterRule
	} from '$lib/contentFilter';
	import {
		loadFilterAction,
		loadHideRules,
		saveHideRules,
		FILTER_ACTION_PREFIX,
		FILTER_ACTION_OPTIONS,
		type FilterAction
	} from '$lib/filterHide';

	let { feedId }: { feedId: number } = $props();

	// The modal is keyed by feedId upstream ({#key}), so it remounts per feed — snapshotting the
	// prop's initial value here is intentional.
	// svelte-ignore state_referenced_locally
	const feed = feeds.getRawFeed(feedId);

	// Filter-field baseline (only the fields this panel edits).
	const initial = {
		block_filter_entry_rules: feed?.block_filter_entry_rules ?? '',
		keep_filter_entry_rules: feed?.keep_filter_entry_rules ?? '',
		blocklist_rules: feed?.blocklist_rules ?? '',
		keeplist_rules: feed?.keeplist_rules ?? ''
	};

	// --- Content filters (friendly builder) -------------------------------------------------
	// Rows are edited the same way regardless of action. The per-feed *action* decides where they
	// live and how they apply:
	//   'block'      → compiled to Miniflux field-scoped rules (block/keep_filter_entry_rules);
	//                  matches are never downloaded. Rows using unknown fields (EntryTag/EntryDate)
	//                  drop a group into a raw-textarea escape hatch; a legacy single-regex
	//                  blocklist/keeplist is migrated into Title rows and cleared on save.
	//   'mark-read'  → rows live in localStorage; the app marks matches read on load (see
	//                  filterHide + entries store). Miniflux rules are cleared so it downloads all.
	// svelte-ignore state_referenced_locally
	const action0 = loadFilterAction(feedId);
	const usingClient0 = action0 === 'mark-read';
	// svelte-ignore state_referenced_locally
	const hideRules0 = loadHideRules(feedId);
	const parsedFilters = parseRules(initial);

	let filterAction = $state<FilterAction>(action0);
	let blockRows = $state<FilterRule[]>(
		usingClient0
			? hideRules0.filter((r) => r.list === 'block')
			: parsedFilters.blockClean
				? parsedFilters.rules.filter((r) => r.list === 'block')
				: []
	);
	let keepRows = $state<FilterRule[]>(
		usingClient0
			? hideRules0.filter((r) => r.list === 'keep')
			: parsedFilters.keepClean
				? parsedFilters.rules.filter((r) => r.list === 'keep')
				: []
	);
	let blockRaw = $state(!usingClient0 && !parsedFilters.blockClean);
	let keepRaw = $state(!usingClient0 && !parsedFilters.keepClean);
	// Raw-mode textareas hold the field-filter text (source of truth only while in raw mode).
	let blockFilterText = $state(initial.block_filter_entry_rules);
	let keepFilterText = $state(initial.keep_filter_entry_rules);

	const isMarkRead = $derived(filterAction === 'mark-read');
	const compiledFilters = $derived(compileRules([...blockRows, ...keepRows]));
	// Miniflux fields: emptied entirely in mark-read mode (the app filters client-side instead).
	const effBlockFilter = $derived(isMarkRead ? '' : blockRaw ? blockFilterText : compiledFilters.block_filter_entry_rules);
	const effKeepFilter = $derived(isMarkRead ? '' : keepRaw ? keepFilterText : compiledFilters.keep_filter_entry_rules);
	const effBlocklist = $derived(isMarkRead ? '' : blockRaw ? initial.blocklist_rules : '');
	const effKeeplist = $derived(isMarkRead ? '' : keepRaw ? initial.keeplist_rules : '');
	// Client-side hide rules (only populated in mark-read mode); persisted to localStorage.
	const effHideRules = $derived(
		isMarkRead ? [...blockRows, ...keepRows].filter((r) => r.value.trim() !== '') : []
	);
	const effHideSig = $derived(JSON.stringify(effHideRules));
	const initialFilterAction = action0;
	const initialHideSig = JSON.stringify(
		usingClient0
			? [...hideRules0.filter((r) => r.list === 'block'), ...hideRules0.filter((r) => r.list === 'keep')].filter(
					(r) => r.value.trim() !== ''
				)
			: []
	);

	function setFilterAction(a: FilterAction) {
		filterAction = a;
		if (a === 'mark-read') {
			blockRaw = false; // client matching supports only the simple fields
			keepRaw = false;
		}
	}

	function addBlockRow() {
		blockRows = [...blockRows, { list: 'block', field: 'title', mode: 'contains', value: '' }];
	}
	function addKeepRow() {
		keepRows = [...keepRows, { list: 'keep', field: 'title', mode: 'contains', value: '' }];
	}
	function removeBlockRow(i: number) {
		blockRows = blockRows.filter((_, idx) => idx !== i);
	}
	function removeKeepRow(i: number) {
		keepRows = keepRows.filter((_, idx) => idx !== i);
	}

	function toggleBlockRaw() {
		if (!blockRaw) {
			blockFilterText = compiledFilters.block_filter_entry_rules; // seed the textarea from the rows
			blockRaw = true;
		} else {
			const p = parseRules({ block_filter_entry_rules: blockFilterText });
			if (p.blockClean) {
				blockRows = p.rules.filter((r) => r.list === 'block');
				blockRaw = false;
			} else {
				ui.showError('These rules use fields the simple editor can’t show (e.g. EntryTag/EntryDate) — keep editing them here.');
			}
		}
	}
	function toggleKeepRaw() {
		if (!keepRaw) {
			keepFilterText = compiledFilters.keep_filter_entry_rules;
			keepRaw = true;
		} else {
			const p = parseRules({ keep_filter_entry_rules: keepFilterText });
			if (p.keepClean) {
				keepRows = p.rules.filter((r) => r.list === 'keep');
				keepRaw = false;
			} else {
				ui.showError('These rules use fields the simple editor can’t show (e.g. EntryTag/EntryDate) — keep editing them here.');
			}
		}
	}

	// --- Duplicate handling (client-side, per feed, localStorage) ---------------------
	// svelte-ignore state_referenced_locally
	const dedupKey = DEDUP_STORAGE_PREFIX + feedId;
	const dedup0 = asDedupMode(storageGetString(dedupKey, 'off'));
	let dedupMode = $state<DedupMode>(dedup0);
	const initialDedupMode = dedup0;

	let saving = $state(false);

	const dirty = $derived(
		dedupMode !== initialDedupMode ||
		effBlockFilter !== initial.block_filter_entry_rules ||
		effKeepFilter !== initial.keep_filter_entry_rules ||
		effBlocklist !== initial.blocklist_rules ||
		effKeeplist !== initial.keeplist_rules ||
		filterAction !== initialFilterAction ||
		effHideSig !== initialHideSig
	);

	function onclose() {
		ui.closeFiltersPanel();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	function computeChanges(): FeedUpdate {
		const changes: FeedUpdate = {};
		if (effBlockFilter !== initial.block_filter_entry_rules) changes.block_filter_entry_rules = effBlockFilter;
		if (effKeepFilter !== initial.keep_filter_entry_rules) changes.keep_filter_entry_rules = effKeepFilter;
		if (effBlocklist !== initial.blocklist_rules) changes.blocklist_rules = effBlocklist;
		if (effKeeplist !== initial.keeplist_rules) changes.keeplist_rules = effKeeplist;
		return changes;
	}

	async function handleSave() {
		if (!dirty) return;
		saving = true;
		try {
			const changes = computeChanges();
			if (Object.keys(changes).length > 0) await feeds.updateFeed(feedId, changes);
			// Client-side settings (localStorage). In block mode the rules live in Miniflux, so the
			// client hide list is cleared.
			storageSet(dedupKey, dedupMode);
			storageSet(FILTER_ACTION_PREFIX + feedId, filterAction);
			saveHideRules(feedId, effHideRules);

			// In "mark read" mode, apply the rules to the existing backlog right away, so saving the
			// filter has immediate effect rather than only on the next per-page load.
			if (isMarkRead && effHideRules.length > 0) {
				const n = await entries.applyHideToExisting(feedId, effHideRules);
				ui.showSuccess(
					n > 0
						? `Filters saved — marked ${n} existing ${n === 1 ? 'post' : 'posts'} read.`
						: 'Filters saved.'
				);
			} else {
				ui.showSuccess('Filters saved.');
			}

			// Re-apply visibly over the live list (dedup + hide-on-load) when it's the open feed.
			if (ui.selectedFeed && ui.selectedFeed.id === feedId) {
				await entries.loadEntries(ui.selectedFeed.apiPath);
			}
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
<div class="fixed inset-0 z-40 bg-black/30" onclick={onclose}></div>

<div class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
	<div class="bg-surface rounded-lg shadow-xl w-full max-w-lg mx-4 pointer-events-auto flex max-h-[85vh] flex-col">
		<div class="px-5 py-4 border-b border-n-200 flex items-center gap-2 shrink-0">
			<ListFilter class="size-5 text-n-500" />
			<h2 class="text-lg font-semibold text-n-800 min-w-0 truncate">
				Filters{feed ? ` — ${feed.title}` : ''}
			</h2>
			<button
				type="button"
				onclick={onclose}
				title="Close"
				class="ml-auto shrink-0 rounded-full p-1.5 text-n-500 hover:bg-n-100 hover:text-n-700"
			>
				<X class="size-5" />
			</button>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			<div class="space-y-4">
				<!-- Duplicate entries -->
				<div>
					<div class="mb-1 block text-sm font-medium text-n-700">Duplicate entries</div>
					<div class="inline-flex overflow-hidden rounded-md border border-n-300">
						{#each DEDUP_OPTIONS as opt, i (opt.value)}
							<button
								type="button"
								onclick={() => (dedupMode = opt.value)}
								aria-pressed={dedupMode === opt.value}
								class="px-3 py-1.5 text-sm {i > 0 ? 'border-l border-n-300' : ''} {dedupMode === opt.value
									? 'bg-a-600 text-white'
									: 'bg-surface text-n-700 hover:bg-n-100'}"
							>
								{opt.label}
							</button>
						{/each}
					</div>
					<p class="mt-1 text-xs text-n-500">
						Hide repeated entries in this feed (the source sometimes posts the same release twice).
						"By URL" is exact; "By URL + title" also collapses reposts with identical titles. Applies
						when the feed is next loaded.
					</p>
				</div>

				<!-- Content filters — friendly builder. The action decides whether matches are dropped at
				     download (Miniflux rules) or kept but marked read (client-side). Each row targets one
				     field (title, content, link, author). -->
				<div class="rounded-md border border-n-200 bg-n-50 px-3 py-2">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-medium text-n-700">On match:</span>
						<select
							aria-label="Filter action"
							value={filterAction}
							onchange={(e) => setFilterAction(e.currentTarget.value as FilterAction)}
							class="rounded-md border border-n-300 bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						>
							{#each FILTER_ACTION_OPTIONS as o (o.value)}
								<option value={o.value}>{o.label}</option>
							{/each}
						</select>
					</div>
					<p class="mt-1 text-xs text-n-500">
						{#if isMarkRead}
							Posts are still downloaded but marked read, so they leave the unread list yet stay
							recoverable (visible under “show all”, and they return if you remove the rule). This app
							applies it when you open the feed; syncs across devices.
						{:else}
							Matching posts are discarded by Miniflux and never downloaded — permanent, affects only
							new entries.
						{/if}
					</p>
				</div>

				<div>
					<div class="mb-1 flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-sm font-medium text-n-700">
							Ignore posts
							<a
								href="https://miniflux.app/docs/rules.html#filtering-rules"
								target="_blank"
								rel="noopener noreferrer"
								title="Miniflux documentation"
								class="text-a-600 hover:text-a-700"
							>
								<ExternalLink class="h-3.5 w-3.5" />
							</a>
						</span>
						{#if !isMarkRead}
							<button type="button" onclick={toggleBlockRaw} class="text-xs text-a-600 hover:text-a-700">
								{blockRaw ? 'Simple filters' : 'Edit as rules'}
							</button>
						{/if}
					</div>
					{#if blockRaw}
						<textarea
							id="feed-blocklist"
							bind:value={blockFilterText}
							rows="3"
							spellcheck="false"
							placeholder="EntryTitle=(?i)sponsored&#10;EntryContent=(?i)advertisement"
							class="w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						></textarea>
					{:else}
						<div class="space-y-2">
							{#each blockRows as rule, i (i)}
								<div class="flex items-center gap-2">
									<select
										bind:value={rule.field}
										aria-label="Field"
										class="shrink-0 rounded-md border border-n-300 bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
									>
										{#each FILTER_FIELDS as f (f.value)}
											<option value={f.value}>{f.label}</option>
										{/each}
									</select>
									<select
										bind:value={rule.mode}
										aria-label="Match mode"
										class="shrink-0 rounded-md border border-n-300 bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
									>
										<option value="contains">contains</option>
										<option value="regex">regex</option>
									</select>
									<input
										type="text"
										bind:value={rule.value}
										spellcheck="false"
										placeholder="Gamesblender"
										class="min-w-0 flex-1 rounded-md border border-n-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
									/>
									<button
										type="button"
										onclick={() => removeBlockRow(i)}
										title="Remove filter"
										class="shrink-0 rounded-md p-1.5 text-n-400 hover:bg-n-100 hover:text-n-700"
									>
										<X class="h-4 w-4" />
									</button>
								</div>
							{/each}
							<button
								type="button"
								onclick={addBlockRow}
								class="inline-flex items-center gap-1 rounded-md border border-n-300 px-2 py-1 text-xs text-n-700 hover:bg-n-100"
							>
								<Plus class="h-3.5 w-3.5" /> Add filter
							</button>
						</div>
					{/if}
					<p class="mt-1 text-xs text-n-500">
						{isMarkRead ? 'Marks read' : 'Discards'} entries matching any rule. Each rule checks a single
						field; <em>contains</em> is plain, case-insensitive text.
					</p>
				</div>

				<div>
					<div class="mb-1 flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-sm font-medium text-n-700">
							Keep only posts
							<a
								href="https://miniflux.app/docs/rules.html#filtering-rules"
								target="_blank"
								rel="noopener noreferrer"
								title="Miniflux documentation"
								class="text-a-600 hover:text-a-700"
							>
								<ExternalLink class="h-3.5 w-3.5" />
							</a>
						</span>
						{#if !isMarkRead}
							<button type="button" onclick={toggleKeepRaw} class="text-xs text-a-600 hover:text-a-700">
								{keepRaw ? 'Simple filters' : 'Edit as rules'}
							</button>
						{/if}
					</div>
					{#if keepRaw}
						<textarea
							id="feed-keeplist"
							bind:value={keepFilterText}
							rows="3"
							spellcheck="false"
							placeholder="EntryTitle=(?i)svelte&#10;EntryContent=(?i)typescript"
							class="w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
						></textarea>
					{:else}
						<div class="space-y-2">
							{#each keepRows as rule, i (i)}
								<div class="flex items-center gap-2">
									<select
										bind:value={rule.field}
										aria-label="Field"
										class="shrink-0 rounded-md border border-n-300 bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
									>
										{#each FILTER_FIELDS as f (f.value)}
											<option value={f.value}>{f.label}</option>
										{/each}
									</select>
									<select
										bind:value={rule.mode}
										aria-label="Match mode"
										class="shrink-0 rounded-md border border-n-300 bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
									>
										<option value="contains">contains</option>
										<option value="regex">regex</option>
									</select>
									<input
										type="text"
										bind:value={rule.value}
										spellcheck="false"
										placeholder="svelte"
										class="min-w-0 flex-1 rounded-md border border-n-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
									/>
									<button
										type="button"
										onclick={() => removeKeepRow(i)}
										title="Remove filter"
										class="shrink-0 rounded-md p-1.5 text-n-400 hover:bg-n-100 hover:text-n-700"
									>
										<X class="h-4 w-4" />
									</button>
								</div>
							{/each}
							<button
								type="button"
								onclick={addKeepRow}
								class="inline-flex items-center gap-1 rounded-md border border-n-300 px-2 py-1 text-xs text-n-700 hover:bg-n-100"
							>
								<Plus class="h-3.5 w-3.5" /> Add filter
							</button>
						</div>
					{/if}
					<p class="mt-1 text-xs text-n-500">
						When set, keeps only new entries that match (all others are discarded). Leave empty to keep
						everything.
					</p>
				</div>
			</div>
		</div>

		<div class="flex shrink-0 justify-end gap-2 border-t border-n-200 px-5 py-4">
			<button
				type="button"
				onclick={onclose}
				class="rounded-md px-4 py-2 text-sm text-n-600 hover:bg-n-100"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={handleSave}
				disabled={saving || !dirty}
				class="rounded-md bg-a-600 px-4 py-2 text-sm text-white hover:bg-a-700 disabled:opacity-50"
			>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>
</div>
