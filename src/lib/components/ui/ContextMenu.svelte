<script lang="ts">
	import { Icon } from 'lucide-svelte';

	interface MenuItem {
		label: string;
		icon?: typeof Icon;
		action: () => void;
		/** Draw a divider above this item. */
		divider?: boolean;
		disabled?: boolean;
		/** Extra classes for the icon (e.g. animate-spin while the action runs). */
		iconClass?: string;
	}

	let { x, y, items, onclose, anchor, align = 'left', width }: {
		x: number;
		y: number;
		items: MenuItem[];
		onclose: () => void;
		/** Trigger element, if any — clicks on it are left to the trigger's own toggle. */
		anchor?: HTMLElement | null;
		/** 'right': x is the menu's right edge (a menu hanging off a button's right end). */
		align?: 'left' | 'right';
		/** Fixed width in px; otherwise the menu sizes to its longest item. */
		width?: number;
	} = $props();

	let menuEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!menuEl) return;
		const rect = menuEl.getBoundingClientRect();
		if (align === 'right') {
			menuEl.style.left = `${Math.max(4, x - rect.width)}px`;
		} else if (rect.right > window.innerWidth) {
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
			if (anchor?.contains(e.target as Node)) return;
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
	role="menu"
	class="fixed z-50 min-w-44 bg-surface text-n-700 rounded-xl p-1.5 shadow-pop"
	style="left: {x}px; top: {y}px;{width ? ` width: ${width}px;` : ''}"
>
	{#each items as item (item.label)}
		{#if item.divider}
			<div class="h-px bg-n-200/70 m-1"></div>
		{/if}
		<button
			role="menuitem"
			disabled={item.disabled}
			onclick={() => { item.action(); onclose(); }}
			class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] text-left transition-colors hover:bg-n-50 disabled:opacity-50 disabled:pointer-events-none"
		>
			{#if item.icon}
				<item.icon size={16} class="shrink-0 text-n-500 {item.iconClass ?? ''}" />
			{/if}
			{item.label}
		</button>
	{/each}
</div>
