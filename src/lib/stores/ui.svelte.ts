import type { Entry, FeedNode } from '$lib/types';

const SIDEBAR_WIDTH_KEY = 'sidebarWidth';
const DEFAULT_SIDEBAR_WIDTH = 256;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;

function createUI() {
	let selectedFeed = $state<FeedNode | null>(null);
	let selectedEntry = $state<Entry | null>(null);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let errorMessage = $state('');
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;
	let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);

	function initSidebarWidth() {
		const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
		if (saved) {
			const w = parseInt(saved, 10);
			if (w >= MIN_SIDEBAR_WIDTH && w <= MAX_SIDEBAR_WIDTH) sidebarWidth = w;
		}
	}

	function setSidebarWidth(w: number) {
		sidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, w));
		localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
	}

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
		get sidebarWidth() { return sidebarWidth; },
		selectFeed,
		selectEntry,
		toggleSidebar,
		setMobile,
		showError,
		clearError,
		initSidebarWidth,
		setSidebarWidth
	};
}

export const ui = createUI();
