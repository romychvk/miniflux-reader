<script lang="ts">
	import type { Component } from 'svelte';

	interface MenuItem {
		label: string;
		icon?: Component<{ size: number }>;
		action: () => void;
	}

	let { x, y, items, onclose }: {
		x: number;
		y: number;
		items: MenuItem[];
		onclose: () => void;
	} = $props();

	let menuEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!menuEl) return;
		const rect = menuEl.getBoundingClientRect();
		if (rect.right > window.innerWidth) {
			menuEl.style.left = `${window.innerWidth - rect.width - 4}px`;
		}
		if (rect.bottom > window.innerHeight) {
			menuEl.style.top = `${window.innerHeight - rect.height - 4}px`;
		}
	});

	$effect(() => {
		function onkeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') onclose();
		}
		function onclick(e: MouseEvent) {
			if (menuEl && !menuEl.contains(e.target as Node)) onclose();
		}
		function onscroll() {
			onclose();
		}

		function oncontextmenu(e: MouseEvent) {
			if (menuEl && !menuEl.contains(e.target as Node)) onclose();
		}

		window.addEventListener('keydown', onkeydown);
		window.addEventListener('click', onclick, true);
		window.addEventListener('contextmenu', oncontextmenu, true);
		window.addEventListener('scroll', onscroll, true);

		return () => {
			window.removeEventListener('keydown', onkeydown);
			window.removeEventListener('click', onclick, true);
			window.removeEventListener('contextmenu', oncontextmenu, true);
			window.removeEventListener('scroll', onscroll, true);
		};
	});
</script>

<div
	bind:this={menuEl}
	class="fixed z-50 min-w-40 bg-white border border-n-200 rounded-lg shadow-lg py-1"
	style="left: {x}px; top: {y}px;"
>
	{#each items as item}
		<button
			onclick={() => { item.action(); onclose(); }}
			class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-n-700 hover:bg-n-100 text-left"
		>
			{#if item.icon}
				<item.icon size={15} />
			{/if}
			{item.label}
		</button>
	{/each}
</div>
