import type { AiMessage, RuleSuggestion } from '$lib/types';
import { aiConfig } from '$lib/stores/aiConfig.svelte';
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

// Run one pass against the configured provider. `messages` is the full
// conversation so far (initial request, plus any refine turns).
export async function requestRules(messages: AiMessage[]): Promise<RuleSuggestion> {
	if (!aiConfig.isConfigured) {
		throw new Error('AI assistant is not configured. Set it up in Settings.');
	}

	const res = await fetch('/api/ai', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-AI-Key': aiConfig.apiKey
		},
		body: JSON.stringify({
			provider: aiConfig.provider,
			model: aiConfig.model,
			system: SYSTEM_PROMPT,
			messages
		})
	});

	const data = await res.json().catch(() => null);
	if (!res.ok) {
		throw new Error(data?.error || `AI request failed (${res.status})`);
	}
	return parseSuggestion(data?.text ?? '');
}
