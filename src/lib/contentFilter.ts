// Friendly layer over Miniflux's entry filter rules. We edit filters as a list of simple rows
// and compile them to Miniflux's field-scoped fields:
//   block_filter_entry_rules / keep_filter_entry_rules — one `EntryField=regex` per line.
// These let a rule target a single field (title only, body only, …), which the legacy single-
// regex blocklist_rules/keeplist_rules can't do. The builder owns the two field-scoped fields
// and clears the legacy ones; an existing legacy value is migrated into Title rows on save.
// See Miniflux internal/reader/filter/filter.go for the matching semantics.

export type FilterList = 'block' | 'keep';
export type FilterField = 'title' | 'content' | 'url' | 'author';
export type FilterMode = 'contains' | 'regex';

export interface FilterRule {
	list: FilterList;
	field: FilterField;
	mode: FilterMode;
	value: string;
}

// Field options offered in the UI (label = what the user sees).
export const FILTER_FIELDS: { value: FilterField; label: string }[] = [
	{ value: 'title', label: 'Title' },
	{ value: 'content', label: 'Content' },
	{ value: 'url', label: 'Link' },
	{ value: 'author', label: 'Author' }
];

const FIELD_TO_MF: Record<FilterField, string> = {
	title: 'EntryTitle',
	content: 'EntryContent',
	url: 'EntryURL',
	author: 'EntryAuthor'
};
const MF_TO_FIELD: Record<string, FilterField> = {
	EntryTitle: 'title',
	EntryContent: 'content',
	EntryURL: 'url',
	EntryAuthor: 'author'
};

// Escape a literal so it matches itself inside a regex.
export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The RE2 pattern for a rule's value: a "contains" literal becomes a case-insensitive escaped
// match; a "regex" value is used verbatim.
export function rulePattern(mode: FilterMode, value: string): string {
	return mode === 'contains' ? `(?i)${escapeRegex(value)}` : value;
}

function ruleToLine(rule: FilterRule): string {
	return `${FIELD_TO_MF[rule.field]}=${rulePattern(rule.mode, rule.value)}`;
}

export interface CompiledFilters {
	block_filter_entry_rules: string;
	keep_filter_entry_rules: string;
}

// Compile rows into the two field-scoped strings (newline-joined `EntryField=regex` lines).
export function compileRules(rules: FilterRule[]): CompiledFilters {
	const lines = (list: FilterList) =>
		rules
			.filter((r) => r.list === list && r.value.trim() !== '')
			.map(ruleToLine)
			.join('\n');
	return {
		block_filter_entry_rules: lines('block'),
		keep_filter_entry_rules: lines('keep')
	};
}

// --- Parsing (regex → rows) ---------------------------------------------------------------

// Split a regex body on top-level `|` (an alternation separator is an *unescaped* pipe).
function splitAlternatives(body: string): string[] {
	const parts: string[] = [];
	let cur = '';
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (c === '\\') {
			cur += c + (body[i + 1] ?? '');
			i++;
		} else if (c === '|') {
			parts.push(cur);
			cur = '';
		} else {
			cur += c;
		}
	}
	parts.push(cur);
	return parts;
}

// If every regex metacharacter in `alt` is backslash-escaped, return the unescaped literal;
// otherwise null (it uses real regex syntax).
function asLiteral(alt: string): string | null {
	let out = '';
	for (let i = 0; i < alt.length; i++) {
		const c = alt[i];
		if (c === '\\') {
			const next = alt[i + 1];
			if (next === undefined) return null;
			out += next;
			i++;
		} else if ('.*+?^${}()|[]'.includes(c)) {
			return null;
		} else {
			out += c;
		}
	}
	return out;
}

// A single field-filter pattern → {mode, value}. `(?i)`-prefixed pure literals become
// "contains"; anything else stays "regex" (verbatim, flags included).
function patternToModeValue(pattern: string): { mode: FilterMode; value: string } {
	if (pattern.startsWith('(?i)')) {
		const lit = asLiteral(pattern.slice(4));
		if (lit !== null) return { mode: 'contains', value: lit };
	}
	return { mode: 'regex', value: pattern };
}

// Migrate a legacy single-regex list (blocklist_rules/keeplist_rules) into Title rows. The old
// field matched title/URL/author together; we narrow it to the title, which is the common intent
// (and what this app's earlier quick-filter created).
function legacyToRows(regex: string, list: FilterList): FilterRule[] {
	const input = regex.trim();
	if (input === '') return [];
	const body = input.startsWith('(?i)') ? input.slice(4) : input;
	// A clean `(?i)`-prefixed alternation of literals → one contains row per term; anything else
	// is kept as a single regex row so a hand-written expression isn't mangled.
	if (input.startsWith('(?i)')) {
		const alts = splitAlternatives(body);
		if (alts.every((a) => asLiteral(a) !== null && a.trim() !== '')) {
			return alts.map((a) => ({ list, field: 'title', mode: 'contains', value: asLiteral(a)! }));
		}
	}
	return [{ list, field: 'title', mode: 'regex', value: input }];
}

// Parse one list's field-filter text into rows. `clean` is false when a line can't be shown as a
// simple row (unknown field like EntryTag/EntryDate, or no `=`), so the caller shows a raw editor.
function parseFieldRules(text: string, list: FilterList): { rules: FilterRule[]; clean: boolean } {
	const lines = (text ?? '')
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s !== '');
	const rules: FilterRule[] = [];
	let clean = true;
	for (const line of lines) {
		const eq = line.indexOf('=');
		const field = eq > 0 ? MF_TO_FIELD[line.slice(0, eq).trim()] : undefined;
		if (eq < 0 || !field) {
			clean = false;
			continue;
		}
		rules.push({ list, field, ...patternToModeValue(line.slice(eq + 1).trim()) });
	}
	return { rules, clean };
}

export interface FeedFilterFields {
	block_filter_entry_rules?: string;
	keep_filter_entry_rules?: string;
	blocklist_rules?: string;
	keeplist_rules?: string;
}

export interface ParsedFilters {
	rules: FilterRule[];
	blockClean: boolean; // false → block list shown as a raw field-filter textarea
	keepClean: boolean;
	hasLegacyBlock: boolean; // a legacy blocklist_rules was migrated into rows
	hasLegacyKeep: boolean;
}

// Read a feed's filter fields into editable rows. Field-filter lines become field rows; a legacy
// single-regex value is migrated into Title rows (so it stays visible/removable).
export function parseRules(feed: FeedFilterFields): ParsedFilters {
	const block = parseFieldRules(feed.block_filter_entry_rules ?? '', 'block');
	const keep = parseFieldRules(feed.keep_filter_entry_rules ?? '', 'keep');
	const legacyBlock = (feed.blocklist_rules ?? '').trim() !== '';
	const legacyKeep = (feed.keeplist_rules ?? '').trim() !== '';

	// Only migrate a legacy value when its list is otherwise "clean" (shown as rows); a raw list
	// keeps the legacy value untouched (see FeedSettings' effBlocklist/effKeeplist handling).
	if (legacyBlock && block.clean) block.rules.push(...legacyToRows(feed.blocklist_rules!, 'block'));
	if (legacyKeep && keep.clean) keep.rules.push(...legacyToRows(feed.keeplist_rules!, 'keep'));

	return {
		rules: [...block.rules, ...keep.rules],
		blockClean: block.clean,
		keepClean: keep.clean,
		hasLegacyBlock: legacyBlock && block.clean,
		hasLegacyKeep: legacyKeep && keep.clean
	};
}

// Append a field-scoped rule line to an existing field-filter string (used by the quick action),
// deduping an identical line.
export function appendFieldRule(
	current: string,
	field: FilterField,
	value: string,
	mode: FilterMode = 'contains'
): string {
	const term = value.trim();
	if (term === '') return current ?? '';
	const line = ruleToLine({ list: 'block', field, mode, value: term });
	const lines = (current ?? '')
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s !== '');
	if (lines.includes(line)) return lines.join('\n');
	return [...lines, line].join('\n');
}

// Suggest a block phrase from an entry title: the leading text before an issue marker
// (№ / # / a number). Falls back to the whole title when that yields nothing useful.
export function suggestFilterPhrase(title: string): string {
	const t = (title ?? '').trim();
	const m = t.match(/^(.+?)\s*(?:[№#]|\d)/);
	const phrase = (m ? m[1] : t).replace(/[\s:–—\-|·]+$/, '').trim();
	return phrase.length >= 2 ? phrase : t;
}

// Convert a Miniflux (Go RE2) regex to a JS RegExp for client-side matching. Go's inline `(?i)`
// flag isn't valid in `new RegExp()`, so lift it to the `i` flag. Returns null on any syntax JS
// can't handle — callers then skip client-side matching.
export function toJsRegex(minifluxRegex: string): RegExp | null {
	const src = (minifluxRegex ?? '').trim();
	if (src === '') return null;
	try {
		return src.startsWith('(?i)') ? new RegExp(src.slice(4), 'i') : new RegExp(src);
	} catch {
		return null;
	}
}
