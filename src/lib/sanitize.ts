import DOMPurify from 'dompurify';
import { browser } from '$app/environment';
import { isAllowedEmbed } from '$lib/embedHosts';

let hookInstalled = false;
function installHook(): void {
	if (hookInstalled) return;
	// ADD_TAGS keeps <iframe> in the output; this hook then removes the ones that aren't a
	// known embed host, so only the video/audio players survive.
	DOMPurify.addHook('uponSanitizeElement', (node, data) => {
		if (data.tagName === 'iframe') {
			const el = node as Element;
			if (!isAllowedEmbed(el.getAttribute('src') ?? '')) {
				el.parentNode?.removeChild(el);
			}
		}
	});
	// The surviving (host-gated) embeds validate their embedding origin via the referrer.
	// DOMPurify drops the `referrerpolicy` YouTube's markup ships with, and the app's
	// document-wide `no-referrer` (for hotlink-protected images) would then starve the player
	// — YouTube shows "error 153". Re-set it on iframes only, so images keep `no-referrer`.
	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		const el = node as Element;
		if (el.tagName === 'IFRAME') {
			el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
		}
	});
	hookInstalled = true;
}

// Sanitize untrusted HTML immediately before it reaches {@html}. Article content is nominally
// sanitized by Miniflux, but that's server config we don't control from here, and the AI rule
// assistant renders raw model output (which prompt injection can steer). DOMPurify strips scripts,
// on* handlers and unsafe URL schemes; we additionally forbid object/embed/form controls and
// <style>, and keep iframes only for the embed hosts above.
export function sanitizeHtml(html: string): string {
	if (!html) return '';
	// Content is only ever rendered client-side (the app is auth-gated behind onMount); never emit
	// unsanitized HTML from the server, and DOMPurify needs a real DOM anyway.
	if (!browser) return '';
	installHook();
	return DOMPurify.sanitize(html, {
		ADD_TAGS: ['iframe'],
		ADD_ATTR: [
			'allow',
			'allowfullscreen',
			'frameborder',
			'scrolling',
			'loading',
			'target',
			'controls',
			'playsinline'
		],
		FORBID_TAGS: [
			'style',
			'form',
			'input',
			'button',
			'select',
			'option',
			'textarea',
			'object',
			'embed',
			'label',
			'fieldset'
		],
		FORBID_ATTR: ['srcdoc', 'ping']
	});
}
