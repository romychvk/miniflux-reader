import type { Entry } from '$lib/types';

// The language tag to put in a `lang` attribute for an entry's own text (title, summary,
// article body). The document is `lang="en"` (app.html), so without this every article —
// Ukrainian, Russian, English alike — is announced as English by screen readers, hyphenated
// by English rules, and skipped by the browser's translation offer.
//
// Miniflux 2.3.3 is the first release that reads the language a feed or entry declares
// (RSS <language>, dc:language, Atom xml:lang, JSON Feed "language") and stores it, so the
// field is simply absent on anything older, and empty on any feed that declares nothing —
// most RSS-Bridge output, for one.
//
// Expect it to stay empty for a while after an upgrade, and to fill in unevenly. A feed only
// learns its language on a refresh that actually parses a body: answer 304 Not Modified and
// Miniflux skips parsing, so a quiet feed keeps an empty language until it next publishes.
// An entry's own language is written when it is *inserted*, so the whole existing backlog
// stays empty permanently — that backlog is what the fallback to the feed is for.
//
// Nothing is ever guessed. With no declared language we return undefined, the attribute is
// omitted, and the document's own `lang` keeps applying — a wrong `lang` is worse than a
// generic one, because it makes a screen reader read Ukrainian with English phonetics and
// actively suppresses the translation prompt.

// A conservative BCP-47 shape: `uk`, `en-US`, `zh-Hant-TW`. Deliberately not a full parser —
// this only has to be safe to emit as an attribute value.
const TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

// Miniflux normalises on its side too (trims, lowercases, `_` → `-`, and rejects outright
// anything outside [a-z0-9-] or over 50 characters, so a `ru-RU, en-US` list never reaches us
// from a 2.3.3 instance). This repeats the work rather than trusting it: the value is written
// straight into an attribute, and the same field also arrives from whatever instance the user
// happens to point at.
export function normalizeLang(value: string | undefined | null): string | undefined {
	if (!value) return undefined;
	const tag = value.trim().split(/[,;\s]/)[0].replaceAll('_', '-');
	return TAG.test(tag) ? tag : undefined;
}

export function entryLang(entry: Entry): string | undefined {
	return normalizeLang(entry.language) ?? normalizeLang(entry.feed?.language);
}
