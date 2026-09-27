import type {
	Category,
	Entry,
	EntryScope,
	Feed,
	FeedCounters,
	FeedCreate,
	FeedIcon,
	FeedUpdate,
	FoundFeed
} from '$lib/types';

// The reader talks to its backend through this interface and nothing else. Today the one
// implementation is Miniflux (backend/miniflux.ts, a 1:1 map onto its REST API); the interface
// exists so a fork can plug in another engine behind the same stores and components without
// touching either. The model types stay the Miniflux-shaped ones in $lib/types — every component
// consumes them, and any other engine answers in the same shape.

export type BackendKind = 'miniflux' | 'microrss';

export interface EntryQuery {
	status?: 'unread' | 'read'; // omitted = any status
	search?: string;
	limit: number;
	offset?: number;
	order?: 'published_at';
	direction?: 'asc' | 'desc';
}

export interface EntryPage {
	total: number;
	entries: Entry[];
}

// What a backend can do beyond the common surface. Components gate their Miniflux-only UI on
// these rather than on the backend's name, so a third engine only has to say what it supports.
export interface BackendCapabilities {
	// The RSS-Bridge tab in Feed Settings, the bridge offers in Add Feed and the CssSelectorBridge
	// wizard: a feed_url pointing at a bridge instance is only meaningful when the engine polls it
	// like any other feed and knows nothing about it, which is Miniflux's case.
	rssBridge: boolean;
}

export interface CurrentUser {
	id: number;
	username: string;
	is_admin?: boolean;
}

export interface ReaderBackend {
	readonly kind: BackendKind;
	readonly caps: BackendCapabilities;

	me(signal?: AbortSignal): Promise<CurrentUser>;

	listFeeds(signal?: AbortSignal): Promise<Feed[]>;
	listCategories(signal?: AbortSignal): Promise<Category[]>;
	counters(signal?: AbortSignal): Promise<FeedCounters>;
	feedIcon(feedId: number, signal?: AbortSignal): Promise<FeedIcon>;
	createFeed(data: FeedCreate): Promise<{ feed_id: number }>;
	updateFeed(feedId: number, changes: FeedUpdate): Promise<void>;
	deleteFeed(feedId: number): Promise<void>;
	// Blocks until the feed has been crawled, so counters read afterwards are trustworthy.
	refreshFeed(feedId: number): Promise<void>;
	createCategory(title: string): Promise<Category>;
	updateCategory(categoryId: number, title: string): Promise<void>;

	listEntries(scope: EntryScope, query: EntryQuery, signal?: AbortSignal): Promise<EntryPage>;
	getEntry(entryId: number, signal?: AbortSignal): Promise<Entry>;
	setStatus(entryIds: number[], status: 'read' | 'unread'): Promise<void>;
	// The whole unread backlog of a feed, a category or everything — not just a loaded page.
	// Bookmarks have no such operation anywhere; callers page through them instead.
	markAllRead(scope: Exclude<EntryScope, { kind: 'starred' }>): Promise<void>;
	// Flips the flag server-side; the caller mirrors it locally after success.
	toggleBookmark(entryId: number): Promise<void>;
	// Re-scrape the original page with the feed's rules, persist the result, return the content
	// as stored — one operation to the caller however many requests it takes the engine.
	fetchContent(entryId: number): Promise<string>;

	// Feeds the engine can find for a page URL; empty when it finds none or cannot fetch the page.
	discover(pageUrl: string): Promise<FoundFeed[]>;
}
