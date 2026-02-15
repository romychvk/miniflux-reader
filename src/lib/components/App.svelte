<script lang="ts">
	import { onMount } from 'svelte';
	import { feeds } from '$lib/stores/feeds.svelte';
	import { entries } from '$lib/stores/entries.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import Sidebar from './sidebar/Sidebar.svelte';
	import TopBar from './topbar/TopBar.svelte';
	import EntryList from './content/EntryList.svelte';
	import Toast from './ui/Toast.svelte';

	onMount(() => {
		// Check mobile
		const mql = window.matchMedia('(max-width: 768px)');
		ui.setMobile(mql.matches);
		mql.addEventListener('change', (e) => ui.setMobile(e.matches));

		// Load feeds
		feeds.loadFeeds();
	});

	// Load entries when feed changes
	$effect(() => {
		const feed = ui.selectedFeed;
		if (feed) {
			entries.loadEntries(feed.apiPath);
		}
	});
</script>

<div class="flex h-screen bg-gray-50">
	<Sidebar />
	<div class="flex flex-col flex-1 min-w-0">
		<TopBar />
		<main class="flex-1 overflow-y-auto">
			<EntryList />
		</main>
	</div>
</div>
<Toast />
