<script lang="ts">
	import { Circle, CircleDot, ChevronDown, ChevronUp } from 'lucide-svelte';
	import type { Entry } from '$lib/types';
	import { entries } from '$lib/stores/entries.svelte';
	import { relaTimestamp } from '$lib/time';
	import EntryContent from './EntryContent.svelte';

	let { entry, onCollapse }: { entry: Entry; onCollapse: () => void } = $props();

	let open = $state(false);
	let rowEl: HTMLElement | undefined = $state();
	let wasInView = $state(false);

	const isRead = $derived(entry.status === 'read');

	function toggleOpen() {
		open = !open;
		if (!open) onCollapse();
	}

	function toggleRead(e: Event) {
		e.stopPropagation();
		entries.markRead([entry.id], !isRead);
	}

	export function collapse() {
		open = false;
	}

	// IntersectionObserver action for auto-mark-read
	function autoMarkRead(node: HTMLElement) {
		let prevInView = false;
		let scrollDirection: 'up' | 'down' = 'down';
		let lastScrollY = 0;

		function onScroll() {
			const currentScrollY = window.scrollY;
			scrollDirection = currentScrollY > lastScrollY ? 'down' : 'up';
			lastScrollY = currentScrollY;
		}

		window.addEventListener('scroll', onScroll, { passive: true });

		const observer = new IntersectionObserver(
			([e]) => {
				const inView = e.isIntersecting;
				if (!inView && prevInView && entry.status === 'unread' && scrollDirection === 'down') {
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
				window.removeEventListener('scroll', onScroll);
			}
		};
	}
</script>

<div
	class="border-b border-gray-100"
	bind:this={rowEl}
	use:autoMarkRead
>
	<!-- Header row -->
	<div
		class="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors {isRead ? 'opacity-60' : ''}"
		onclick={toggleOpen}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Enter' && toggleOpen()}
	>
		<button
			onclick={toggleRead}
			class="shrink-0 text-blue-500 hover:text-blue-700 p-0.5"
			title={isRead ? 'Mark as unread' : 'Mark as read'}
		>
			{#if isRead}
				<Circle size={16} />
			{:else}
				<CircleDot size={16} />
			{/if}
		</button>

		<div class="flex-1 min-w-0">
			<h3 class="text-sm font-medium truncate">{entry.title}</h3>
			<p class="text-xs text-gray-400 mt-0.5">
				{entry.feed.title} &middot; {relaTimestamp(entry.published_at)}
			</p>
		</div>

		<span class="shrink-0 text-gray-400">
			{#if open}
				<ChevronUp size={16} />
			{:else}
				<ChevronDown size={16} />
			{/if}
		</span>
	</div>

	<!-- Expanded content -->
	{#if open}
		<div class="px-3 pb-4">
			<a
				href={entry.url}
				target="_blank"
				rel="noopener noreferrer"
				class="text-xs text-blue-600 hover:underline mb-2 block"
			>
				Open original
			</a>
			<EntryContent {entry} />
		</div>
	{/if}
</div>
