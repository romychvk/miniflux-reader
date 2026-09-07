// Strips the parts of a page an LLM (or a human skimming markup) never needs — comments,
// scripts, styles, inline SVG, noscript — so the remaining HTML fits a prompt budget. Shared by
// /api/fetch-page and /api/page-feed/preview.
export function clean(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<script\b[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[\s\S]*?<\/style>/gi, '')
		.replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
		.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
		.replace(/\s+\n/g, '\n')
		.trim();
}
