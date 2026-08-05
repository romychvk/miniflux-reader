<script lang="ts">
	let {
		active,
		coverSelector = $bindable(),
		coverAttr = $bindable()
	}: {
		active: boolean;
		coverSelector: string;
		coverAttr: string;
	} = $props();
</script>

<section class:hidden={!active} class="rounded-lg border border-n-100 shadow-xl bg-surface p-5">
	<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Cover Image</h3>
	<p class="mb-4 text-xs text-n-500">
		Where to find the card/article cover when the source has no <code>og:image</code>. Leave empty
		to use the default (the page's Open Graph image). Set a CSS selector to pull it from specific
		markup — some forum engines keep the cover in <code>&lt;var class="postImg" title="…"&gt;</code>,
		so use selector <code>var.postImg</code> with attribute <code>title</code>.
	</p>
	<div class="flex flex-wrap gap-4">
		<div class="grow">
			<label for="feed-cover-selector" class="mb-1 block text-sm font-medium text-n-700">CSS selector</label>
			<input
				id="feed-cover-selector"
				type="text"
				bind:value={coverSelector}
				spellcheck="false"
				placeholder="var.postImg"
				class="w-full rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
			/>
		</div>
		<div class="w-full sm:w-48">
			<label for="feed-cover-attr" class="mb-1 block text-sm font-medium text-n-700">Attribute</label>
			<input
				id="feed-cover-attr"
				type="text"
				bind:value={coverAttr}
				spellcheck="false"
				placeholder="title (auto if empty)"
				class="w-full rounded-md border border-n-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-n-400"
			/>
		</div>
	</div>
	<p class="mt-1 text-xs text-n-500">
		Attribute holding the URL. If empty, the app auto-detects (src, data-src, href, content, title).
		Applies when the feed is next loaded.
	</p>
</section>
