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
	icon?: { feed_id: number; icon_id: number };
}

export interface Entry {
	id: number;
	title: string;
	url: string;
	author: string;
	content: string;
	status: 'unread' | 'read';
	published_at: string;
	feed: Feed;
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
