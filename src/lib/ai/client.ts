import type { AiMessage, RuleSuggestion } from '$lib/types';
import { aiConfig } from '$lib/stores/aiConfig.svelte';
import { authedFetch } from '$lib/api';
import { SYSTEM_PROMPT } from './prompt';

// Pull the JSON object out of the model's reply, tolerating ``` fences or stray
// prose around it, and coerce the fields to the RuleSuggestion shape.
function parseSuggestion(text: string): RuleSuggestion {
	let raw = text.trim();
	const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) raw = fence[1].trim();
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) {
		throw new Error('AI did not return a rule suggestion.');
	}
	let obj: Record<string, unknown>;
	try {
		obj = JSON.parse(raw.slice(start, end + 1));
	} catch {
		throw new Error('Could not parse the AI response.');
	}
	return {
		scraper_rules: typeof obj.scraper_rules === 'string' ? obj.scraper_rules.trim() : '',
		rewrite_rules: typeof obj.rewrite_rules === 'string' ? obj.rewrite_rules.trim() : '',
		explanation: typeof obj.explanation === 'string' ? obj.explanation : ''
	};
}

// Run one pass against the configured provider and return the raw reply text.
// `messages` is the full conversation so far (initial request, plus any refine turns).
export async function requestAi(system: string, messages: AiMessage[]): Promise<string> {
	if (!aiConfig.isConfigured) {
		throw new Error('AI assistant is not configured. Set it up in Settings.');
	}

	// authedFetch adds the Miniflux credential headers — /api/ai is gated like the other
	// helper endpoints so it can't be driven anonymously as an open relay.
	const res = await authedFetch('/api/ai', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-AI-Key': aiConfig.apiKey
		},
		body: JSON.stringify({
			provider: aiConfig.provider,
			model: aiConfig.model,
			system,
			messages
		})
	});

	const data = await res.json().catch(() => null);
	if (!res.ok) {
		throw new Error(data?.error || `AI request failed (${res.status})`);
	}
	return data?.text ?? '';
}

export async function requestRules(messages: AiMessage[]): Promise<RuleSuggestion> {
	return parseSuggestion(await requestAi(SYSTEM_PROMPT, messages));
}
