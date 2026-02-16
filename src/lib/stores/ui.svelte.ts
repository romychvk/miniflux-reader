import type { Entry, FeedNode } from '$lib/types';

const SIDEBAR_WIDTH_KEY = 'sidebarWidth';
const DEFAULT_SIDEBAR_WIDTH = 256;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;

const LAYOUT_MODE_KEY = 'layoutMode';
const ARTICLE_PANEL_WIDTH_KEY = 'articlePanelWidth';
const DEFAULT_ARTICLE_PANEL_WIDTH = 550;
const MIN_ARTICLE_PANEL_WIDTH = 300;
const MIN_ENTRY_LIST_WIDTH = 320;

type LayoutMode = 'two-column' | 'three-column';

function createUI() {
	let selectedFeed = $state<FeedNode | null>(null);
	let selectedEntry = $state<Entry | null>(null);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let errorMessage = $state('');
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;
	let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	let layoutMode = $state<LayoutMode>('two-column');
	let articlePanelWidth = $state(DEFAULT_ARTICLE_PANEL_WIDTH);

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

	function initLayoutMode() {
		const saved = localStorage.getItem(LAYOUT_MODE_KEY);
		if (saved === 'two-column' || saved === 'three-column') layoutMode = saved;
	}

	function toggleLayoutMode() {
		layoutMode = layoutMode === 'two-column' ? 'three-column' : 'two-column';
		localStorage.setItem(LAYOUT_MODE_KEY, layoutMode);
	}

	function initArticlePanelWidth() {
		const saved = localStorage.getItem(ARTICLE_PANEL_WIDTH_KEY);
		if (saved) {
			const w = parseInt(saved, 10);
			if (w >= MIN_ARTICLE_PANEL_WIDTH) articlePanelWidth = w;
		}
	}

	function setArticlePanelWidth(w: number) {
		const maxW = window.innerWidth - sidebarWidth - MIN_ENTRY_LIST_WIDTH;
		articlePanelWidth = Math.max(MIN_ARTICLE_PANEL_WIDTH, Math.min(maxW, w));
		localStorage.setItem(ARTICLE_PANEL_WIDTH_KEY, String(articlePanelWidth));
	}

	return {
		get selectedFeed() { return selectedFeed; },
		get selectedEntry() { return selectedEntry; },
		get sidebarOpen() { return sidebarOpen; },
		get isMobile() { return isMobile; },
		get errorMessage() { return errorMessage; },
		get sidebarWidth() { return sidebarWidth; },
		get layoutMode() { return layoutMode; },
		get articlePanelWidth() { return articlePanelWidth; },
		selectFeed,
		selectEntry,
		toggleSidebar,
		setMobile,
		showError,
		clearError,
		initSidebarWidth,
		setSidebarWidth,
		initLayoutMode,
		toggleLayoutMode,
		initArticlePanelWidth,
		setArticlePanelWidth
	};
}

export const ui = createUI();
