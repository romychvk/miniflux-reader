// A client-side approximation of Miniflux's rewrite_rules, used to preview cleanup on a
// feed's existing (non-crawled) content. When the crawler is off, Miniflux shows
// rewrite(default_content), and there is no API to compute that without re-scraping the
// original page — so we simulate the two functions that matter for trimming here.
//
// Fidelity caveat: remove() uses the browser's CSS engine, which is slightly more
// permissive than Miniflux's goquery/cascadia (e.g. it accepts `:has(> a)` and other
// selectors cascadia rejects). The assistant's system prompt steers the model toward
// cascadia-safe selectors, so in practice the preview matches — treat it as a close
// approximation, not ground truth.

export interface RewriteCall {
	fn: string;
	args: string[];
}

// Only these are simulated; everything else is reported by unsupportedFunctions().
const SUPPORTED = new Set(['remove', 'replace']);

const domParser = new DOMParser();

// Parse a rewrite_rules string into ordered calls, mirroring Miniflux's own parser
// (Go text/scanner): arguments are DOUBLE-quoted strings, `|` separates the two args of
// replace(), and commas/whitespace separate calls. Single quotes inside a "..." are
// literal characters — which is exactly why attribute selectors must use single quotes
// (a nested double quote terminates the string early, in Miniflux and here alike).
export function parseRewriteRules(rules: string): RewriteCall[] {
	const calls: RewriteCall[] = [];
	const n = rules.length;
	let i = 0;

	const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

	const readString = (): string | null => {
		if (rules[i] !== '"') return null;
		i++; // opening quote
		let s = '';
		while (i < n) {
			const c = rules[i];
			if (c === '\\' && i + 1 < n) {
				s += rules[i + 1];
				i += 2;
				continue;
			}
			if (c === '"') {
				i++; // closing quote
				return s;
			}
			s += c;
			i++;
		}
		return s; // unterminated — return what we have
	};

	while (i < n) {
		// skip separators (whitespace + commas) between calls
		while (i < n && (isWs(rules[i]) || rules[i] === ',')) i++;
		if (i >= n) break;

		// function name
		const start = i;
		while (i < n && /[a-zA-Z0-9_]/.test(rules[i])) i++;
		const fn = rules.slice(start, i);
		if (!fn) {
			i++; // stray char — advance to avoid an infinite loop
			continue;
		}

		while (i < n && isWs(rules[i])) i++;
		if (rules[i] !== '(') {
			// bare directive, e.g. add_dynamic_image / nl2br
			calls.push({ fn, args: [] });
			continue;
		}
		i++; // '('

		const args: string[] = [];
		while (i < n) {
			while (i < n && isWs(rules[i])) i++;
			if (rules[i] === ')') break;
			const str = readString();
			if (str === null) break; // unexpected token
			args.push(str);
			while (i < n && isWs(rules[i])) i++;
			if (rules[i] === '|') {
				i++; // separator between replace() args
				continue;
			}
			break;
		}
		while (i < n && rules[i] !== ')') i++;
		if (i < n) i++; // consume ')'

		calls.push({ fn, args });
	}

	return calls;
}

function applyRemove(html: string, selector: string): string {
	const doc = domParser.parseFromString(html, 'text/html');
	let matched = false;
	try {
		for (const el of doc.querySelectorAll(selector)) {
			el.remove();
			matched = true;
		}
	} catch {
		return html; // selector invalid for the browser engine — leave content untouched
	}
	return matched ? doc.body.innerHTML : html;
}

function applyReplace(html: string, pattern: string, replacement: string): string {
	try {
		return html.replace(new RegExp(pattern, 'g'), replacement);
	} catch {
		return html; // invalid regex — no-op
	}
}

// Apply remove()/replace() to the content, in the order written (output of each call
// feeds the next, as Miniflux chains them). Unsupported functions are skipped.
export function applyRewriteRules(html: string, rules: string): string {
	let out = html;
	for (const call of parseRewriteRules(rules)) {
		if (call.fn === 'remove' && call.args[0]) {
			out = applyRemove(out, call.args[0]);
		} else if (call.fn === 'replace' && call.args.length >= 2) {
			out = applyReplace(out, call.args[0], call.args[1]);
		}
	}
	return out;
}

// Names of functions present in the rules that this previewer does not simulate, so the
// UI can warn that the local preview is partial.
export function unsupportedFunctions(rules: string): string[] {
	const names = new Set<string>();
	for (const call of parseRewriteRules(rules)) {
		if (!SUPPORTED.has(call.fn)) names.add(call.fn);
	}
	return [...names];
}
