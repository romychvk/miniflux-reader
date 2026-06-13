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

type LayoutMode = 'two-column' | 'three-column' | 'expanded';
const LAYOUT_MODES: LayoutMode[] = ['two-column', 'three-column', 'expanded'];
type ViewMode = 'list' | 'magazine' | 'cards';
const VIEW_MODES: ViewMode[] = ['list', 'magazine', 'cards'];

function createUI() {
	let selectedFeed = $state<FeedNode | null>(null);
	let selectedEntry = $state<Entry | null>(null);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let errorMessage = $state('');
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;
	let successMessage = $state('');
	let successTimeout: ReturnType<typeof setTimeout> | null = null;
	let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	let layoutMode = $state<LayoutMode>('two-column');
	let viewMode = $state<ViewMode>('list');
	let viewModesMap = $state<Record<string, ViewMode>>({});
	let articlePanelWidth = $state(DEFAULT_ARTICLE_PANEL_WIDTH);
	let autoMarkReadOnScroll = $state(true);
	let markReadSuppressedUntil = 0;
	let lightboxImages = $state<string[]>([]);
	let lightboxIndex = $state(0);

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

	function showSuccess(msg: string) {
		successMessage = msg;
		if (successTimeout) clearTimeout(successTimeout);
		successTimeout = setTimeout(() => { successMessage = ''; }, 5000);
	}

	function clearSuccess() {
		successMessage = '';
		if (successTimeout) clearTimeout(successTimeout);
	}

	function selectEntry(entry: Entry | null) {
		selectedEntry = entry;
	}

	function openLightbox(images: string[], index = 0) {
		lightboxImages = images;
		lightboxIndex = index;
	}

	function closeLightbox() {
		lightboxImages = [];
		lightboxIndex = 0;
	}

	function lightboxNext() {
		if (lightboxImages.length) lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
	}

	function lightboxPrev() {
		if (lightboxImages.length)
			lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
	}

	function initLayoutMode() {
		const saved = storageGetString(LAYOUT_MODE_KEY);
		if (saved && LAYOUT_MODES.includes(saved as LayoutMode)) layoutMode = saved as LayoutMode;
	}

	function setLayoutMode(mode: LayoutMode) {
		layoutMode = mode;
		storageSet(LAYOUT_MODE_KEY, mode);
		if (mode === 'expanded') selectedEntry = null;
	}

	function suppressMarkRead(ms = 800) {
		markReadSuppressedUntil = Date.now() + ms;
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
		get successMessage() { return successMessage; },
		get sidebarWidth() { return sidebarWidth; },
		get layoutMode() { return layoutMode; },
		get isMarkReadSuppressed() { return Date.now() < markReadSuppressedUntil; },
		get viewMode() { return viewMode; },
		get articlePanelWidth() { return articlePanelWidth; },
		get autoMarkReadOnScroll() { return autoMarkReadOnScroll; },
		get lightboxImage() { return lightboxImages[lightboxIndex] ?? null; },
		get lightboxIndex() { return lightboxIndex; },
		get lightboxCount() { return lightboxImages.length; },
		selectFeed,
		selectEntry,
		openLightbox,
		closeLightbox,
		lightboxNext,
		lightboxPrev,
		toggleSidebar,
		setMobile,
		showError,
		clearError,
		showSuccess,
		clearSuccess,
		initSidebarWidth,
		setSidebarWidth,
		initLayoutMode,
		setLayoutMode,
		suppressMarkRead,
		initViewMode,
		setViewMode,
		initAutoMarkRead,
		toggleAutoMarkRead,
		initArticlePanelWidth,
		setArticlePanelWidth
	};
}

export const ui = createUI();
