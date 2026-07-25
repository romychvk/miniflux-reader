export interface Category {
	id: number;
	title: string;
}

export interface Feed {
	id: number;
	title: string;
	site_url: string;
	feed_url: string;
	category: Category;
	// Declared by the feed and stored by Miniflux since 2.3.3 — absent on older instances and
	// on feeds that declare nothing. Read it through $lib/lang, never raw.
	language?: string;
	crawler?: boolean;
	scraper_rules?: string;
	rewrite_rules?: string;
	blocklist_rules?: string;
	keeplist_rules?: string;
	block_filter_entry_rules?: string;
	keep_filter_entry_rules?: string;
	disabled?: boolean;
	ignore_http_cache?: boolean;
	user_agent?: string;
	checked_at?: string;
	parsing_error_count?: number;
	parsing_error_message?: string;
	icon?: { feed_id: number; icon_id: number };
}

export interface FeedCreate {
	feed_url: string;
	category_id: number;
	crawler?: boolean;
}

export interface FeedUpdate {
	title?: string;
	site_url?: string;
	feed_url?: string;
	category_id?: number;
	crawler?: boolean;
	scraper_rules?: string;
	rewrite_rules?: string;
	blocklist_rules?: string;
	keeplist_rules?: string;
	block_filter_entry_rules?: string;
	keep_filter_entry_rules?: string;
	disabled?: boolean;
	ignore_http_cache?: boolean;
	user_agent?: string;
}

export interface Enclosure {
	id?: number;
	url: string;
	mime_type?: string;
}

export interface Entry {
	id: number;
	title: string;
	url: string;
	author: string;
	content: string;
	status: 'unread' | 'read';
	starred: boolean;
	published_at: string;
	// Set when the entry was inserted (Miniflux 2.3.3+), inheriting the feed's language when
	// the entry declares none — so it stays empty on entries that predate the upgrade.
	language?: string;
	feed: Feed;
	enclosures?: Enclosure[];
	_thumbnailUrl?: string | null;
	_description?: string;
}

export type AiProvider = 'anthropic' | 'openai';

export interface AiMessage {
	role: 'user' | 'assistant';
	content: string;
}

// One structured proposal from the rule assistant. Both rule strings may be
// empty (e.g. trim-only suggestions leave scraper_rules untouched).
export interface RuleSuggestion {
	scraper_rules: string;
	rewrite_rules: string;
	explanation: string;
}

export interface FeedNode {
	id: number;
	title: string;
	apiPath: string;
	isFeed: boolean;
	iconData?: string;
	unread: number;
	children?: FeedNode[];
}

export interface FeedCounters {
	reads: Record<number, number>;
	unreads: Record<number, number>;
}

export interface FeedIcon {
	id: number;
	data: string;
	mime_type: string;
}
