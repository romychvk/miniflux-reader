<script lang="ts">
	import { goto } from '$app/navigation';
	import { Circle, CircleDot } from 'lucide-svelte';
	import type { Entry } from '$lib/types';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { relaTimestamp } from '$lib/time';
	import { makeEntrySlug } from '$lib/slug';
	import { getScrollDirection, addScrollTracker, removeScrollTracker } from '$lib/scroll';

	let { entry }: { entry: Entry } = $props();

	let rowEl: HTMLElement | undefined = $state();

	const isRead = $derived(entry.status === 'read');
	const isSelected = $derived(ui.selectedEntry?.id === entry.id);

	const viewMode = $derived(ui.viewMode);

	const thumbnailUrl = $derived(entry._thumbnailUrl ?? null);
	const description = $derived(entry._description ?? '');

	function openArticle() {
		if (!ui.isMobile && ui.layoutMode === 'three-column') {
			ui.selectEntry(entry);
			if (entry.status === 'unread') {
				entries.markRead([entry.id], true);
			}
		} else {
			goto(`/article/${makeEntrySlug(entry.id, entry.title)}`);
		}
	}

	function toggleRead(e: Event) {
		e.stopPropagation();
		entries.markRead([entry.id], !isRead);
	}

	// IntersectionObserver action for auto-mark-read
	function autoMarkRead(node: HTMLElement) {
		let prevInView = false;
		addScrollTracker();

		const observer = new IntersectionObserver(
			([e]) => {
				const inView = e.isIntersecting;
				if (!inView && prevInView && entry.status === 'unread' && getScrollDirection() === 'down') {
					entries.markRead([entry.id], true);
				}
				prevInView = inView;
			},
			{ threshold: 0 }
		);
		observer.observe(node);

		return {
			destroy() {
				observer.disconnect();
				removeScrollTracker();
			}
		};
	}
</script>

{#if viewMode === 'list'}
	<!-- List: compact single-line rows, no images -->
	<div
		class="border-b border-slate-100"
		bind:this={rowEl}
		use:autoMarkRead
	>
		<div
			class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors {isRead ? 'opacity-60' : ''} {isSelected ? 'bg-blue-50' : ''}"
			onclick={openArticle}
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Enter' && openArticle()}
		>
			<button
				onclick={toggleRead}
				class="shrink-0 text-blue-500 hover:text-blue-700 p-0.5"
				title={isRead ? 'Mark as unread' : 'Mark as read'}
			>
				{#if isRead}
					<Circle size={14} />
				{:else}
					<CircleDot size={14} />
				{/if}
			</button>

			<h3 class="text-sm font-medium truncate flex-1 min-w-0">{entry.title}</h3>
			<span class="text-xs text-slate-400 shrink-0">{entry.feed.title}</span>
			<span class="text-xs text-slate-300 shrink-0">&middot;</span>
			<span class="text-xs text-slate-400 shrink-0">{relaTimestamp(entry.published_at)}</span>
		</div>
	</div>

{:else if viewMode === 'magazine'}
	<!-- Magazine: image left, title/date/description right -->
	<div
		class="border-b border-slate-100"
		bind:this={rowEl}
		use:autoMarkRead
	>
		<div
			class="flex gap-4 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors {isRead ? 'opacity-60' : ''} {isSelected ? 'bg-blue-50' : ''}"
			onclick={openArticle}
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Enter' && openArticle()}
		>
			<div class="shrink-0 w-36 h-36 rounded overflow-hidden bg-slate-100">
				{#if thumbnailUrl}
					<img
						src={thumbnailUrl}
						alt=""
						class="w-full h-full object-cover"
						loading="lazy"
					/>
				{:else}
					<div class="w-full h-full flex items-center justify-center text-slate-300">
						<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
						</svg>
					</div>
				{/if}
			</div>

			<div class="flex-1 min-w-0 flex flex-col">
				<div class="flex items-start gap-2">
					<h3 class="text-lg font-semibold line-clamp-2 flex-1">{entry.title}</h3>
					<button
						onclick={toggleRead}
						class="shrink-0 text-blue-500 hover:text-blue-700 p-0.5 mt-0.5"
						title={isRead ? 'Mark as unread' : 'Mark as read'}
					>
						{#if isRead}
							<Circle size={14} />
						{:else}
							<CircleDot size={14} />
						{/if}
					</button>
				</div>
				<p class="text-sm text-slate-500 mt-1">
					{entry.feed.title} &middot; {relaTimestamp(entry.published_at)}
				</p>
				{#if description}
					<p class="text-sm text-slate-800 mt-1.5 line-clamp-4">{description}</p>
				{/if}
			</div>
		</div>
	</div>

{:else}
	<!-- Cards: vertical card, image on top -->
	<div
		bind:this={rowEl}
		use:autoMarkRead
		class="rounded-lg border border-slate-200 bg-white overflow-hidden cursor-pointer hover:shadow-md transition-shadow {isRead ? 'opacity-60' : ''} {isSelected ? 'ring-2 ring-blue-400' : ''}"
		onclick={openArticle}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Enter' && openArticle()}
	>
		{#if thumbnailUrl}
			<div class="w-full overflow-hidden bg-slate-100 rounded-lg">
				<img
					src={thumbnailUrl}
					alt=""
					class="w-full h-full object-cover"
					loading="lazy"
				/>
			</div>
		{/if}

		<div class="p-3">
			<div class="flex items-start gap-2">
				<h3 class="text-base font-semibold line-clamp-3 flex-1">{entry.title}</h3>
				<button
					onclick={toggleRead}
					class="shrink-0 text-blue-500 hover:text-blue-700 p-0.5"
					title={isRead ? 'Mark as unread' : 'Mark as read'}
				>
					{#if isRead}
						<Circle size={14} />
					{:else}
						<CircleDot size={14} />
					{/if}
				</button>
			</div>
			<p class="text-sm text-slate-500 mt-1.5">
				{entry.feed.title} &middot; {relaTimestamp(entry.published_at)}
			</p>
			{#if description}
				<p class="text-sm text-slate-800 mt-1.5 line-clamp-2">{description}</p>
			{/if}
		</div>
	</div>
{/if}
