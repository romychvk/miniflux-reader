import type { Entry, FeedNode } from '$lib/types';

function createUI() {
	let selectedFeed = $state<FeedNode | null>(null);
	let selectedEntry = $state<Entry | null>(null);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let errorMessage = $state('');
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;

	function selectFeed(feed: FeedNode) {
		selectedFeed = feed;
		if (isMobile) sidebarOpen = false;
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	function setMobile(mobile: boolean) {
		isMobile = mobile;
		if (!mobile) sidebarOpen = false;
	}

	function showError(msg: string) {
		errorMessage = msg;
		if (errorTimeout) clearTimeout(errorTimeout);
		errorTimeout = setTimeout(() => { errorMessage = ''; }, 5000);
	}

	function clearError() {
		errorMessage = '';
		if (errorTimeout) clearTimeout(errorTimeout);
	}

	function selectEntry(entry: Entry | null) {
		selectedEntry = entry;
	}

	return {
		get selectedFeed() { return selectedFeed; },
		get selectedEntry() { return selectedEntry; },
		get sidebarOpen() { return sidebarOpen; },
		get isMobile() { return isMobile; },
		get errorMessage() { return errorMessage; },
		selectFeed,
		selectEntry,
		toggleSidebar,
		setMobile,
		showError,
		clearError
	};
}

export const ui = createUI();
