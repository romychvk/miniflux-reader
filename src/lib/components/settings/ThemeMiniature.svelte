<script lang="ts">
	// A thumbnail of the reader shell (rail, tree, card grid) painted with one theme variant's
	// vars. They are set on the root and read with plain var() — the Tailwind color utilities
	// resolve --color-* at :root, so they would keep showing the document's theme.
	let { vars, height = 96 }: { vars: Record<string, string>; height?: number } = $props();

	const style = $derived(
		Object.entries(vars)
			.map(([k, v]) => `--${k}:${v}`)
			.join(';')
	);
	const ring = 'box-shadow:0 0 0 1px color-mix(in oklab,var(--n-900) 8%,transparent)';
</script>

<span
	class="flex overflow-hidden rounded-[7px]"
	style="{style};height:{height}px;background:var(--n-50);box-shadow:0 0 0 1px color-mix(in oklab,var(--n-900) 10%,transparent)"
	aria-hidden="true"
>
	<span class="flex w-3.5 flex-none flex-col items-center gap-1 pt-1.5" style="background:var(--rail)">
		<span class="size-[7px] rounded-[2px]" style="background:var(--rail-active)"></span>
		<span class="size-[7px] rounded-[2px] opacity-50" style="background:var(--rail-fg)"></span>
	</span>
	<span
		class="flex w-13 flex-none flex-col gap-[5px] px-1.5 py-2"
		style="background:var(--sidebar);border-right:1px solid var(--n-200)"
	>
		<span class="h-1 w-3/5 rounded-xs" style="background:var(--n-700)"></span>
		<span class="h-1 w-4/5 rounded-xs" style="background:var(--n-300)"></span>
		<span class="h-2 w-full rounded-[3px]" style="background:color-mix(in oklab,var(--a-600) 14%,transparent)"></span>
		<span class="h-1 w-[70%] rounded-xs" style="background:var(--n-300)"></span>
	</span>
	<span class="grid flex-1 grid-cols-3 gap-[5px] p-2">
		<span class="rounded" style="background:var(--surface);{ring}"></span>
		<span class="rounded" style="background:var(--surface);box-shadow:0 0 0 2px var(--a-600)"></span>
		<span class="rounded" style="background:var(--surface);{ring}"></span>
	</span>
</span>
