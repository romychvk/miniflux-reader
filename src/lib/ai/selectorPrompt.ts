// Prompt + response contract for the scraped-feed wizard's "suggest selector" button.
// The model sees the listing page's HTML and proposes CSS selectors for the repeated
// per-item links; the wizard validates every candidate with querySelectorAll and lets
// the user pick. Kept separate from prompt.ts, which serves the feed-rule assistant.

export const SELECTOR_SYSTEM_PROMPT = `You are given the HTML of a web page that lists many items (news, articles, posts)
but has no RSS feed. Propose CSS selectors that match the repeated per-item LINKS, so an
HTML-to-RSS bridge (RSS-Bridge CssSelectorBridge) can build a feed from them.

Rules for the selectors you propose:
- Each selector must match the <a href> elements DIRECTLY — the bridge reads the href off
  the matched elements. Prefer the anchor wrapping the item's TITLE text, not thumbnail,
  category, author or comment links.
- Use stable, semantic class names (e.g. ".newsCard__title a"); avoid positional selectors
  (nth-child), generated/hashed class names, and :has().
- In attribute selectors use SINGLE quotes: a[href*='/news/'].
- Propose 2-4 alternative candidates, best first. They should each match every listed item
  exactly once (one link per item).
- The HTML may be truncated at the end — that is fine, judge from what is present.

Respond with STRICT JSON ONLY — no markdown, no code fences, no prose outside the JSON.
Shape:
{"url_selectors": ["<best selector>", "<alternative>"], "explanation": "<1-2 concise sentences>"}`;

export interface SelectorSuggestion {
	url_selectors: string[];
	explanation: string;
}

export function buildSelectorUserMessage(ctx: {
	pageUrl: string;
	pageHtml: string;
	hint?: string;
}): string {
	const parts: string[] = [];
	parts.push(`Listing page URL: ${ctx.pageUrl}`);
	if (ctx.hint?.trim()) parts.push(`User hint: ${ctx.hint.trim()}`);
	const html =
		ctx.pageHtml.length > 50_000 ? ctx.pageHtml.slice(0, 50_000) + '\n…[truncated]' : ctx.pageHtml;
	parts.push(`\n--- Page HTML (cleaned) ---\n${html}`);
	parts.push('\nPropose the url_selectors. Respond with the strict JSON object only.');
	return parts.join('\n');
}

// Same fence-tolerant parsing as the rule assistant (see client.ts parseSuggestion).
export function parseSelectorSuggestion(text: string): SelectorSuggestion {
	let raw = text.trim();
	const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) raw = fence[1].trim();
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) {
		throw new Error('AI did not return selector suggestions.');
	}
	let obj: Record<string, unknown>;
	try {
		obj = JSON.parse(raw.slice(start, end + 1));
	} catch {
		throw new Error('Could not parse the AI response.');
	}
	const selectors = Array.isArray(obj.url_selectors)
		? obj.url_selectors.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
		: [];
	if (selectors.length === 0) {
		throw new Error('AI did not return selector suggestions.');
	}
	return {
		url_selectors: selectors.map((s) => s.trim()),
		explanation: typeof obj.explanation === 'string' ? obj.explanation : ''
	};
}
