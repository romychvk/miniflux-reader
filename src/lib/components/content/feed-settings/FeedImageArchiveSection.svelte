<script lang="ts">
	let { active, archiveImages = $bindable() }: { active: boolean; archiveImages: boolean } =
		$props();
</script>

<section class:hidden={!active} class="rounded-lg border border-n-100 shadow-xl bg-surface p-5">
	<h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-n-500">Image Archive</h3>
	<p class="mb-4 text-xs text-n-500">
		Download this feed's images to the reader's own server as its entries arrive, and serve them
		from there. Sources can stop handing their pictures to a third-party page at any time — hotlink
		protection, a bot challenge, or the image simply being deleted — and by then the article is
		already unreadable. Archiving keeps what we have.
	</p>
	<label class="flex items-start gap-3">
		<input
			type="checkbox"
			bind:checked={archiveImages}
			class="mt-0.5 size-4 rounded border-n-300 text-a-600 focus:ring-2 focus:ring-n-400"
		/>
		<span class="text-sm text-n-700">
			Archive images for this feed
			<span class="mt-1 block text-xs text-n-500">
				Off by default: an archived feed's images cost bandwidth and disk on our side, so turn it
				on for the sources worth keeping. Applies to entries loaded from now on — images already
				gone from the source can't be recovered.
			</span>
		</span>
	</label>
</section>
