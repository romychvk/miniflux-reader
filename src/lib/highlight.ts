/**
 * Syntax highlighting for article code blocks — deliberately without language detection.
 *
 * Miniflux's sanitizer strips every attribute from `<pre>`/`<code>`, so a feed's
 * `class="language-js"` never reaches us and the language is unknowable. Guessing it was
 * measured against the actual feeds and got it wrong more often than right: a JS object
 * literal is equally valid-looking CSS and YAML, and highlight.js's confidence score ran
 * *highest* on its wrong answers, so no threshold could filter them. Nothing here guesses.
 * Only constructs that mean the same thing in every language a feed plausibly carries get
 * colored; anything else is left plain, which reads better than a confident lie.
 *
 * Tokenizing walks text nodes instead of rebuilding each block from its text, so whatever
 * shape the feed shipped survives — both the <ins>/<del> diff markers and the one-<p>-per-
 * line form. The trade is that a token straddling an element boundary goes unmatched and
 * simply stays uncolored.
 */

// Words that are a keyword in essentially every language that uses them, so coloring one
// can't be wrong about a language we never identified. SQL's verbs (`select`, `update`,
// `where`) are excluded on purpose — they are ordinary identifiers everywhere else.
const KEYWORDS = [
	'import', 'export', 'from', 'default', 'require', 'module', 'package', 'use', 'using',
	'const', 'let', 'var', 'def', 'func', 'function', 'fn', 'lambda',
	'class', 'struct', 'interface', 'enum', 'trait', 'impl', 'type',
	'extends', 'implements', 'public', 'private', 'protected', 'static', 'readonly', 'void',
	'return', 'yield', 'await', 'async', 'new', 'delete', 'typeof', 'instanceof',
	'if', 'else', 'elif', 'for', 'while', 'switch', 'case', 'break', 'continue',
	'try', 'catch', 'finally', 'throw', 'raise', 'pass',
	'true', 'false', 'null', 'nil', 'none', 'undefined', 'self', 'this', 'super',
];

// One alternation scanned left to right, so the earliest match wins and, at equal
// position, the earlier branch does. That ordering is what keeps the branches honest:
// a comment swallows the quotes inside it, and a key claims its own string before the
// plain-string branch can.
const TOKEN = new RegExp(
	[
		/\/\*[\s\S]*?\*\//.source, // block comment
		// Line comment. The lookbehind keeps `https://…` and `a//b` paths out of it.
		/(?<![:\w/])\/\/[^\n]*/.source,
		// Hash comment. Requiring a space or `!` after `#` is what separates `# note`
		// and `#!/bin/sh` from CSS's `#fff` and `#app`.
		/#(?=[ \t!])[^\n]*/.source,
		// A key: bare or quoted, followed by a colon. Covers JS/JSON object keys, YAML
		// mappings and CSS properties at once — the `(?!\/\/)` again spares URL schemes.
		/(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[A-Za-z_$][\w$-]*)(?=[ \t]*:(?!\/\/))/.source,
		/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/.source, // string
		// Number. The lookbehind keeps digits that are part of an identifier out of it
		// (`--n-100`, `h2`), and there is no trailing \b so a unit suffix doesn't cut the
		// match short — `0.5rem` colors as `0.5`, not a lone `0`.
		/(?<![\w$-])\d[\d_]*(?:\.\d+)?/.source,
		`\\b(?:${KEYWORDS.join('|')})\\b`,
	]
		.map((s) => `(${s})`)
		.join('|'),
	'g'
);

// Per capturing group above, in order.
const CLASSES = ['tok-comment', 'tok-comment', 'tok-comment', 'tok-key', 'tok-string', 'tok-num', 'tok-kw'];

/** Tokenized copy of `text`, or null when nothing matched (leave the node alone). */
function tokenize(doc: Document, text: string): DocumentFragment | null {
	TOKEN.lastIndex = 0;
	let frag: DocumentFragment | null = null;
	let last = 0;
	for (const m of text.matchAll(TOKEN)) {
		frag ??= doc.createDocumentFragment();
		const at = m.index;
		if (at > last) frag.append(text.slice(last, at));
		const group = m.slice(1).findIndex((g) => g !== undefined);
		const span = doc.createElement('span');
		span.className = CLASSES[group];
		span.textContent = m[0];
		frag.append(span);
		last = at + m[0].length;
	}
	if (frag && last < text.length) frag.append(text.slice(last));
	return frag;
}

/** Color the code blocks in `doc`, in place. Returns whether anything changed. */
export function highlightCodeBlocks(doc: Document): boolean {
	let changed = false;
	for (const pre of doc.querySelectorAll('pre')) {
		// Collect first: replacing a text node while walking would disturb the walker.
		const walker = doc.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
		for (const node of nodes) {
			const frag = tokenize(doc, node.data);
			if (!frag) continue;
			node.replaceWith(frag);
			changed = true;
		}
	}
	return changed;
}
