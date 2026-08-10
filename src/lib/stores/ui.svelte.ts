import type { Entry, FeedNode } from '$lib/types';
import { storageGet, storageGetString, storageSet } from '$lib/storage';
import { migrateLegacyZen, parseLayoutMode, type LayoutMode } from '$lib/layoutMode';

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
// Legacy: Zen used to be its own persisted boolean. Read once by initLayoutMode() to migrate.
const ZEN_MODE_KEY = 'zenMode';

// Seed for the "Ignore posts like this" quick-filter modal, opened from an article/list entry.
export interface FilterSeed {
	feedId: number;
	feedTitle: string;
	seedTitle: string;
}

type ViewMode = 'list' | 'magazine' | 'cards';
const VIEW_MODES: ViewMode[] = ['list', 'magazine', 'cards'];

function createUI() {
	let selectedFeed = $state<FeedNode | null>(null);
	let selectedEntry = $state<Entry | null>(null);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let successTimeout: ReturnType<typeof setTimeout> | null = null;
	let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	let layoutMode = $state<LayoutMode>('two-column');
	let viewMode = $state<ViewMode>('list');
	let viewModesMap = $state<Record<string, ViewMode>>({});
	let articlePanelWidth = $state(DEFAULT_ARTICLE_PANEL_WIDTH);
	let autoMarkReadOnScroll = $state(true);
	// Transient, per-visit override of the Zen placement, set by the button in the article's action
	// row: null follows layoutMode, true/false wins over it until the reader leaves the article view.
	// Deliberately never persisted — unlike layoutMode it is not a preference (see clearZenOverride).
	let zenOverride = $state<boolean | null>(null);
	// Set when Zen was entered by navigating away from a split pane. Leaving Zen then has to travel
	// back to that pane rather than just un-hide the sidebar, or the reader is left stranded on the
	// full-page route — which is the "No split" placement they did not choose. Read only at click
	// time, so a plain value like markReadSuppressedUntil rather than $state.
	let zenFromPane = false;
	let markReadSuppressedUntil = 0;
	let lightboxImages = $state<string[]>([]);
	let lightboxIndex = $state(0);
	let filterSeed = $state<FilterSeed | null>(null);
	let filtersFeedId = $state<number | null>(null);

	function initAutoMarkRead() {
		const saved = storageGetString(AUTO_MARK_READ_KEY);
		if (saved === 'false') autoMarkReadOnScroll = false;
	}

	function toggleAutoMarkRead() {
		autoMarkReadOnScroll = !autoMarkReadOnScroll;
		storageSet(AUTO_MARK_READ_KEY, String(autoMarkReadOnScroll));
	}

	// Zen mode: the article alone in the window, sidebar slid away. It is a layoutMode of its own —
	// the reader's standing answer to "where do articles open" — and the button in the article's
	// action row is a transient override of that answer, in either direction, for this visit only.
	const zenActive = () => zenOverride ?? layoutMode === 'zen';

	function toggleZen() {
		zenOverride = !zenActive();
	}

	// Entering Zen from the panel/inline placements, which the /article route has to provide.
	function enterZenFromPane() {
		zenOverride = true;
		zenFromPane = true;
	}

	// Called when the reader leaves the article view, so an override never leaks into the next
	// article opened from the list — that one follows the saved pane mode again.
	function clearZenOverride() {
		zenOverride = null;
		zenFromPane = false;
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
		if (feed.id === -2) return 'starred';
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

	// Errors persist until dismissed (X) or a page reload — they often carry a reason
	// the user needs time to read (e.g. a failed re-fetch), unlike transient successes.
	function showError(msg: string) {
		errorMessage = msg;
	}

	function clearError() {
		errorMessage = '';
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

	function openFilterModal(seed: FilterSeed) {
		filterSeed = seed;
	}

	function closeFilterModal() {
		filterSeed = null;
	}

	function openFiltersPanel(feedId: number) {
		filtersFeedId = feedId;
	}

	function closeFiltersPanel() {
		filtersFeedId = null;
	}

	function initLayoutMode() {
		layoutMode = parseLayoutMode(storageGetString(LAYOUT_MODE_KEY)) ?? layoutMode;

		// One-shot migration off the old standalone `zenMode` boolean, then neutralise the key so it
		// can never re-fire. This runs before settingsSync.start() installs its change listener, so
		// it doesn't push on boot — the next real preference change carries it, since the sync
		// payload is re-collected from all of localStorage anyway.
		const legacyZen = storageGetString(ZEN_MODE_KEY);
		if (legacyZen === 'true') {
			layoutMode = migrateLegacyZen(layoutMode, legacyZen);
			storageSet(LAYOUT_MODE_KEY, layoutMode);
			storageSet(ZEN_MODE_KEY, 'false');
		}
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
		get viewKey() { return selectedFeed ? feedStorageKey(selectedFeed) : 'all'; },
		get articlePanelWidth() { return articlePanelWidth; },
		get autoMarkReadOnScroll() { return autoMarkReadOnScroll; },
		get zenMode() { return zenActive(); },
		get zenCameFromPane() { return zenFromPane; },
		get lightboxImage() { return lightboxImages[lightboxIndex] ?? null; },
		get lightboxIndex() { return lightboxIndex; },
		get lightboxCount() { return lightboxImages.length; },
		get filterSeed() { return filterSeed; },
		get filtersFeedId() { return filtersFeedId; },
		openFilterModal,
		closeFilterModal,
		openFiltersPanel,
		closeFiltersPanel,
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
		toggleZen,
		enterZenFromPane,
		clearZenOverride,
		initArticlePanelWidth,
		setArticlePanelWidth
	};
}

export const ui = createUI();
