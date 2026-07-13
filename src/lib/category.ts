// Miniflux auto-creates a mandatory default category titled "All" for every user.
// Despite the name it only holds the feeds actually assigned to it, which is
// confusing next to our sidebar's synthetic "All" aggregate (id -1). We surface
// that default category as "— Without category —" everywhere in the UI — a pure
// display relabel; the real Miniflux title is never changed.
export const NO_CATEGORY_LABEL = '— Without category —';

// Sentinel <select> value meaning "create a new category…" (real category ids are
// always positive, so -1 never collides with one).
export const NEW_CATEGORY_SENTINEL = -1;

// Miniflux always names its default category with the literal English string "All",
// regardless of the user's locale, so a title match reliably identifies it.
export function categoryDisplayTitle(title: string): string {
	return title === 'All' ? NO_CATEGORY_LABEL : title;
}
