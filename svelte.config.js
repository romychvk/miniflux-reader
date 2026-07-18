import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Hosts whose <iframe> embeds the sanitizer legitimately allows. Keep in sync with EMBED_HOSTS
// in src/lib/embedHosts.ts (the single source of truth for the sanitizer's iframe allowlist).
// We can't import that .ts here: svelte.config.js is loaded by a plain Node loader that may not
// strip types (the Docker base image node:22-alpine can be < 22.18), so a .ts import would break
// the prod build. frame-src mirrors the sanitizer's allow rule: apex or subdomain, https only.
const EMBED_HOSTS = [
	'youtube.com',
	'youtube-nocookie.com',
	'youtu.be',
	'vimeo.com',
	'dailymotion.com',
	'dai.ly',
	'bilibili.com',
	'bandcamp.com',
	'soundcloud.com',
	'spotify.com'
];
const frameSrc = EMBED_HOSTS.flatMap((h) => [`https://${h}`, `https://*.${h}`]);

// CSP is defense-in-depth on top of the DOMPurify sanitizer that runs before every {@html}.
// Enforced in production only; left off in dev so it can't interfere with Vite's HMR (test it
// against a prod build: `pnpm build` then `node build`). Fail-safe direction — anything that
// isn't explicitly `development` (which `vite dev` always sets) gets the policy, so a build with
// NODE_ENV unset is still protected.
const isDev = process.env.NODE_ENV === 'development';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// nonce mode (not hash): SvelteKit stamps a per-request nonce onto its own bootstrap
		// script AND onto the anti-FOUC theme script in app.html (via %sveltekit.nonce%), so no
		// brittle hardcoded hash to maintain. Safe here because nothing is prerendered (the (app)
		// group is ssr=false, every page is dynamically rendered).
		csp: isDev
			? undefined
			: {
					mode: 'nonce',
					directives: {
						'default-src': ['self'],
						// No 'unsafe-inline' — that's the whole point. SvelteKit adds the nonce.
						'script-src': ['self'],
						// External Tailwind/Svelte CSS only; <style> elements stay blocked (none exist
						// at runtime — no Svelte transitions, and DOMPurify forbids <style> in articles).
						'style-src': ['self'],
						// Inline style="" attributes (feed articles are full of them; several Svelte
						// components use them too). Its own directive because SvelteKit adds the nonce to
						// style-src, and a nonce there would otherwise cancel 'unsafe-inline'.
						'style-src-attr': ['unsafe-inline'],
						// Feed icons (data:), article/OG images hotlinked from arbitrary hosts.
						'img-src': ['self', 'data:', 'blob:', 'https:', 'http:'],
						'media-src': ['self', 'data:', 'blob:', 'https:', 'http:'],
						'font-src': ['self', 'data:'],
						// Every client fetch targets /api/* on this origin.
						'connect-src': ['self'],
						'frame-src': frameSrc,
						'frame-ancestors': ['none'],
						'object-src': ['none'],
						'base-uri': ['self'],
						'form-action': ['self']
					}
				}
	}
};

export default config;
