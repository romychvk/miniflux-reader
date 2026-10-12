// Why a source page could not be read, in a sentence a reader can act on. Both backends fail
// the same few ways — a bot check, a refusal, a missing page, an overloaded site — and both used
// to say it in their own shorthand ("fetcher: blocked by Cloudflare challenge (403 status code)
// (entries/22666/fetch-content)", "Source returned 403"). Pure, so the server can word its own
// failures with it and the client can reword the ones that arrive as shorthand.

// What stands in front of a refused page: Cloudflare's challenge, another vendor's bot wall
// (Akamai, PerimeterX, DataDome, Incapsula), or nothing recognisable.
export type PageWall = 'cloudflare' | 'bot' | null;

const CLOUDFLARE_WALL = /challenges\.cloudflare\.com|<title>Just a moment\.\.\.|_cf_chl|cf-browser-verification|cf_chl_opt|Attention Required! \| Cloudflare/i;
const OTHER_WALL = /Access Denied|Pardon Our Interruption|px-captcha|_pxhd|perimeterx|datadome|Request unsuccessful\. Incapsula|Checking your browser|Just a moment\.\.\./i;

// The wall is read from the body: the status alone says refused, the body says by whom. Only
// the head of the body is scanned — a wall page is small, and a real page that merely mentions
// Cloudflare further down is not one.
export function pageWall(status: number, body: string): PageWall {
	if (status !== 403 && status !== 503 && status !== 429) return null;
	const head = body.slice(0, 30_000);
	if (CLOUDFLARE_WALL.test(head)) return 'cloudflare';
	if (OTHER_WALL.test(head)) return 'bot';
	return null;
}

export function httpFailureMessage(status: number, wall: PageWall = null): string {
	if (wall === 'cloudflare') return `The site is protected by a Cloudflare bot check (a CAPTCHA or JavaScript challenge), which the reader cannot pass automatically (HTTP ${status})`;
	if (wall === 'bot') return `The site put a bot check in front of the page, which the reader cannot pass automatically (HTTP ${status})`;
	if (status === 401) return 'The site asks for a sign-in (HTTP 401)';
	if (status === 403) return 'The site refused the request (HTTP 403), most likely a bot protection or a block on server addresses';
	if (status === 404 || status === 410) return `The page does not exist (HTTP ${status})`;
	if (status === 429) return 'The site limits how often it can be read (HTTP 429); try again later';
	if (status >= 500 && status <= 504) return `The site is having trouble right now (HTTP ${status}); try again later`;
	return `The site answered HTTP ${status}`;
}

// The API clients append the path they called — " (entries/22666/fetch-content)" — which says
// nothing to a reader once the message itself is understood.
const PATH_SUFFIX = / \([\w./-]+\)$/;

// A failure message as it arrived (a toast, a feed's last error) → the sentence above when it is
// shorthand for one; anything else comes back untouched.
export function explainError(message: string): string {
	const bare = message.replace(PATH_SUFFIX, '');
	// Miniflux: internal/reader/fetcher/response_handler.go (checked 2026-10-12).
	let m = /^fetcher: blocked by Cloudflare challenge \((\d{3}) status code\)$/.exec(bare);
	if (m) return httpFailureMessage(Number(m[1]), 'cloudflare');
	m = /^fetcher: [^()]+\((\d{3}) status code\)$/.exec(bare);
	if (m) return httpFailureMessage(Number(m[1]));
	// This app's own server routes.
	m = /^Source returned (\d{3})$/.exec(bare);
	if (m) return httpFailureMessage(Number(m[1]));
	return message;
}
