<script lang="ts">
	import { USER_AGENT_PRESETS, CUSTOM_UA, matchUserAgentPreset } from '$lib/userAgent';

	let {
		active,
		userAgent = $bindable(),
		disabled = $bindable(),
		ignoreHttpCache = $bindable()
	}: {
		active: boolean;
		userAgent: string;
		disabled: boolean;
		ignoreHttpCache: boolean;
	} = $props();

	// Which preset the current UA string maps to (drives the selector); typing a
	// value not in the list resolves to CUSTOM_UA, flipping the select to "Custom…".
	const uaPreset = $derived(matchUserAgentPreset(userAgent));
	function applyUaPreset(choice: string) {
		if (choice === CUSTOM_UA) return; // keep whatever's already in the field
		userAgent = choice; // the preset's value ('' for the Miniflux default)
	}
</script>

<section class:hidden={!active} class="rounded-lg border border-n-100 shadow-xl bg-surface p-5">
	<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Network Settings</h3>
	<div>
		<label for="feed-user-agent" class="mb-1 block text-sm font-medium text-n-700">User Agent</label>
		<div class="flex flex-col gap-2">
			<select
				aria-label="User Agent preset"
				value={uaPreset}
				onchange={(e) => applyUaPreset(e.currentTarget.value)}
				class="w-full shrink-0 rounded-md border border-n-300 bg-surface px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-n-400 max-w-fit"
			>
				{#each USER_AGENT_PRESETS as p (p.label)}
					<option value={p.value}>{p.label}</option>
				{/each}
				<option value={CUSTOM_UA}>Custom…</option>
			</select>
			<textarea
				id="feed-user-agent"
				bind:value={userAgent}
				rows="2"
				spellcheck="false"
				placeholder="Leave empty to use the Miniflux default"
				class="min-w-0 w-full resize-y rounded-md border border-n-300 px-3 py-2 font-mono text-xs break-all focus:outline-none focus:ring-2 focus:ring-n-400"
			></textarea>
		</div>
		<p class="mt-1 text-xs text-n-500">
			Overrides the User-Agent Miniflux sends when fetching this feed (its
			<em>Override Default User Agent</em> setting). Empty uses the server default. Some sites
			(e.g. <code>reddit.com</code>) rate-limit that default with HTTP 429 — pick a preset or
			enter your own, then save and refresh the feed.
		</p>
	</div>

	<div class="mt-4 space-y-3 border-t border-n-100 pt-4">
		<div class="flex items-center gap-2">
			<input id="feed-disabled" type="checkbox" bind:checked={disabled} class="rounded border-n-300" />
			<label for="feed-disabled" class="text-sm text-n-700">Pause updates (don't refresh this feed)</label>
		</div>
		<div>
			<div class="flex items-center gap-2">
				<input id="feed-ignore-cache" type="checkbox" bind:checked={ignoreHttpCache} class="rounded border-n-300" />
				<label for="feed-ignore-cache" class="text-sm text-n-700">Ignore HTTP cache (always re-download)</label>
			</div>
			<p class="mt-1 text-xs text-n-500">
				Ignores the server's caching headers (<code>ETag</code>/<code>Last-Modified</code>) and
				re-downloads the whole feed on every refresh instead of trusting a "304 Not Modified".
				Only needed for servers that wrongly report "not modified" so new posts never appear.
			</p>
		</div>
	</div>
</section>
