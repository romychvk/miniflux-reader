import type { Entry, FeedNode } from '$lib/types';
import { storageGet, storageGetString, storageSet } from '$lib/storage';

const SIDEBAR_WIDTH_KEY = 'sidebarWidth';
const DEFAULT_SIDEBAR_WIDTH = 256;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;

const LAYOUT_MODE_KEY = 'layoutMode';
const VIEW_MODE_KEY = 'viewMode';
const VIEW_MODES_MAP_KEY = 'viewModesMap';
const ARTICLE_PANEL_WIDTH_KEY = 'articlePanelWidth';
const DEFAULT_ARTICLE_PANEL_WIDTH = 550;
const MIN_ARTICLE_PANEL_WIDTH = 300;
const MIN_ENTRY_LIST_WIDTH = 320;
const AUTO_MARK_READ_KEY = 'autoMarkReadOnScroll';

type LayoutMode = 'two-column' | 'three-column';
type ViewMode = 'list' | 'magazine' | 'cards';
const VIEW_MODES: ViewMode[] = ['list', 'magazine', 'cards'];

function createUI() {
	let selectedFeed = $state<FeedNode | null>(null);
	let selectedEntry = $state<Entry | null>(null);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let errorMessage = $state('');
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;
	let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	let layoutMode = $state<LayoutMode>('two-column');
	let viewMode = $state<ViewMode>('list');
	let viewModesMap = $state<Record<string, ViewMode>>({});
	let articlePanelWidth = $state(DEFAULT_ARTICLE_PANEL_WIDTH);
	let autoMarkReadOnScroll = $state(true);

	function initAutoMarkRead() {
		const saved = storageGetString(AUTO_MARK_READ_KEY);
		if (saved === 'false') autoMarkReadOnScroll = false;
	}

	function toggleAutoMarkRead() {
		autoMarkReadOnScroll = !autoMarkReadOnScroll;
		storageSet(AUTO_MARK_READ_KEY, String(autoMarkReadOnScroll));
	}

	function initSidebarWidth() {
		const saved = storageGetString(SIDEBAR_WIDTH_KEY);
		if (saved) {
			const w = parseInt(saved, 10);
			if (w >= MIN_SIDEBAR_WIDTH && w <= MAX_SIDEBAR_WIDTH) sidebarWidth = w;
		}
	}

	function setSidebarWidth(w: number) {
		sidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, w));
		storageSet(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
	}

	function feedStorageKey(feed: FeedNode): string {
		if (feed.id === -1) return 'all';
		return feed.isFeed ? `feed:${feed.id}` : `category:${feed.id}`;
	}

	function selectFeed(feed: FeedNode) {
		selectedFeed = feed;
		const key = feedStorageKey(feed);
		if (key in viewModesMap) viewMode = viewModesMap[key];
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
		const saved = storageGetString(LAYOUT_MODE_KEY);
		if (saved === 'two-column' || saved === 'three-column') layoutMode = saved;
	}

	function toggleLayoutMode() {
		layoutMode = layoutMode === 'two-column' ? 'three-column' : 'two-column';
		storageSet(LAYOUT_MODE_KEY, layoutMode);
	}

	function initViewMode() {
		const saved = storageGetString(VIEW_MODE_KEY);
		if (saved && VIEW_MODES.includes(saved as ViewMode)) viewMode = saved as ViewMode;
		const map = storageGet<Record<string, ViewMode>>(VIEW_MODES_MAP_KEY, {});
		if (map && typeof map === 'object') viewModesMap = map;
	}

	function setViewMode(mode: ViewMode) {
		viewMode = mode;
		storageSet(VIEW_MODE_KEY, mode);
		if (selectedFeed) {
			const key = feedStorageKey(selectedFeed);
			viewModesMap[key] = mode;
			storageSet(VIEW_MODES_MAP_KEY, viewModesMap);
		}
	}

	function initArticlePanelWidth() {
		const saved = storageGetString(ARTICLE_PANEL_WIDTH_KEY);
		if (saved) {
			const w = parseInt(saved, 10);
			if (w >= MIN_ARTICLE_PANEL_WIDTH) articlePanelWidth = w;
		}
	}

	function setArticlePanelWidth(w: number) {
		const maxW = window.innerWidth - sidebarWidth - MIN_ENTRY_LIST_WIDTH;
		articlePanelWidth = Math.max(MIN_ARTICLE_PANEL_WIDTH, Math.min(maxW, w));
		storageSet(ARTICLE_PANEL_WIDTH_KEY, String(articlePanelWidth));
	}

	return {
		get selectedFeed() { return selectedFeed; },
		get selectedEntry() { return selectedEntry; },
		get sidebarOpen() { return sidebarOpen; },
		get isMobile() { return isMobile; },
		get errorMessage() { return errorMessage; },
		get sidebarWidth() { return sidebarWidth; },
		get layoutMode() { return layoutMode; },
		get viewMode() { return viewMode; },
		get articlePanelWidth() { return articlePanelWidth; },
		get autoMarkReadOnScroll() { return autoMarkReadOnScroll; },
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
		initViewMode,
		setViewMode,
		initAutoMarkRead,
		toggleAutoMarkRead,
		initArticlePanelWidth,
		setArticlePanelWidth
	};
}

export const ui = createUI();
