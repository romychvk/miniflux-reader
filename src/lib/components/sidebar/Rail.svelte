<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Bookmark, House, LogOut, Monitor, Moon, Rss, Settings, Sun } from 'lucide-svelte';
	import { backend } from '$lib/backend';
	import { auth } from '$lib/stores/auth.svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { theme } from '$lib/stores/theme.svelte';

	// The desktop rail: app-level destinations (All, Bookmarks, Settings) and the account, kept out
	// of the feed tree so the tree is only feeds. Mobile keeps the drawer, which carries all of
	// these itself.

	const allUnread = $derived(feeds.feedTree.find((n) => n.id === -1)?.unread ?? 0);

	const routeId = $derived(page.route.id ?? '');
	const isAll = $derived(routeId === '/(app)');
	const isStarred = $derived(routeId === '/(app)/starred');
	const isSettings = $derived(routeId === '/(app)/settings');

	// Flips the mode on screen (see theme.toggleMode); the icon shows what is on screen, the title the preference.
	const ModeIcon = $derived(theme.effectiveMode === 'dark' ? Moon : Sun);
	const modeTitle = $derived(
		`Theme: ${theme.modePref === 'system' ? `system (${theme.effectiveMode})` : theme.modePref} — click for ${
			theme.effectiveMode === 'dark' ? 'light' : 'dark'
		}`
	);

	const serverHost = $derived.by(() => {
		try {
			return new URL(auth.serverUrl).host;
		} catch {
			return auth.serverUrl;
		}
	});

	let me = $state<{ username: string; is_admin?: boolean } | null>(null);
	const displayName = $derived(me?.username || serverHost);
	const initial = $derived((displayName.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase());

	onMount(() => {
		backend()
			.me()
			.then((m) => (me = m))
			.catch(() => {}); // the avatar falls back to the server host's initial
	});

	let accountOpen = $state(false);
	let avatarEl = $state<HTMLButtonElement | null>(null);
	let popoverEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!accountOpen) return;
		function onclick(e: MouseEvent) {
			const t = e.target as Node;
			if (avatarEl?.contains(t) || popoverEl?.contains(t)) return;
			accountOpen = false;
		}
		function onkeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				accountOpen = false;
				avatarEl?.focus();
			}
		}
		window.addEventListener('click', onclick, true);
		window.addEventListener('keydown', onkeydown);
		return () => {
			window.removeEventListener('click', onclick, true);
			window.removeEventListener('keydown', onkeydown);
		};
	});

	function logout() {
		accountOpen = false;
		auth.logout();
		goto('/login');
	}
</script>

{#snippet railLink(href: string, label: string, active: boolean, Icon: typeof House)}
	<a
		{href}
		title={label}
		aria-label={label}
		aria-current={active ? 'page' : undefined}
		class="relative grid place-items-center size-10 rounded-[10px] transition-colors {active
			? 'bg-rail-active text-rail-active-fg'
			: 'hover:bg-rail-strong/16 hover:text-rail-strong'}"
	>
		<Icon size={20} strokeWidth={2} />
	</a>
{/snippet}

<div class="w-13 shrink-0 bg-rail text-rail-fg flex flex-col items-center gap-1.5 pt-2.5 pb-3">
	<a
		href="/"
		title="Miniflux Reader"
		aria-label="Miniflux Reader"
		class="grid place-items-center size-8 rounded-[9px] bg-rail-active text-rail-active-fg mb-2.5"
	>
		<Rss size={17} strokeWidth={2.5} />
	</a>
	{@render railLink('/', allUnread > 0 ? `All · ${allUnread}` : 'All', isAll, House)}
	{@render railLink('/starred', 'Bookmarks', isStarred, Bookmark)}
	<span class="flex-1"></span>
	<button
		type="button"
		onclick={theme.toggleMode}
		title={modeTitle}
		aria-label={modeTitle}
		class="grid place-items-center size-10 rounded-[10px] transition-colors hover:bg-rail-strong/16 hover:text-rail-strong"
	>
		<ModeIcon size={20} strokeWidth={2} />
	</button>
	{@render railLink('/settings', 'Settings', isSettings, Settings)}
	<button
		bind:this={avatarEl}
		onclick={() => (accountOpen = !accountOpen)}
		title={displayName}
		aria-label="Account"
		aria-haspopup="menu"
		aria-expanded={accountOpen}
		class="mt-1.5 grid place-items-center size-7 rounded-full bg-rail-active text-rail-active-fg text-[12px] font-bold shadow-[0_0_0_2px_var(--color-rail),0_0_0_3.5px_var(--color-rail-active)]"
	>
		{initial}
	</button>
</div>

{#if accountOpen}
	<div
		bind:this={popoverEl}
		role="menu"
		class="fixed left-15 bottom-2.5 z-50 w-58 bg-surface text-n-900 rounded-xl p-1.5 shadow-pop"
	>
		<div class="flex items-center gap-2.5 px-2 pt-2 pb-2.5">
			<span
				class="grid place-items-center size-8.5 shrink-0 rounded-full bg-a-600 text-on-accent text-sm font-bold"
			>
				{initial}
			</span>
			<span class="min-w-0">
				<span class="block truncate text-[13px] font-semibold leading-tight">{displayName}</span>
				<span class="block truncate text-[11px] text-n-500 leading-tight mt-0.5">
					Miniflux{me?.is_admin ? ' · admin' : ' account'}
				</span>
			</span>
		</div>
		<div class="h-px bg-n-200/70 mx-1 mb-1"></div>
		<div class="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] text-n-700" title={auth.serverUrl}>
			<Monitor size={16} class="shrink-0 text-n-500" />
			<span class="truncate">{serverHost}</span>
		</div>
		<button
			role="menuitem"
			onclick={logout}
			class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] text-n-700 hover:bg-n-50 text-left"
		>
			<LogOut size={16} class="shrink-0 text-n-500" />
			Logout
		</button>
	</div>
{/if}
