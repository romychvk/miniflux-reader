import type { RequestHandler } from './$types';
import type { AiMessage, AiProvider } from '$lib/types';

// Server-side proxy to an LLM provider. Mirrors the Miniflux proxy model: the
// user's API key never lives on the server — it is sent per-request in the
// X-AI-Key header and forwarded to the provider. This also sidesteps CORS
// (Anthropic blocks direct browser calls) and keeps the key out of page JS logs.

interface AiRequest {
	provider: AiProvider;
	model: string;
	system: string;
	messages: AiMessage[];
	maxTokens?: number;
}

async function callAnthropic(key: string, req: AiRequest): Promise<string> {
	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'x-api-key': key,
			'anthropic-version': '2023-06-01',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: req.model,
			max_tokens: req.maxTokens ?? 2048,
			system: req.system,
			messages: req.messages.map((m) => ({ role: m.role, content: m.content }))
		})
	});

	const data = await res.json().catch(() => null);
	if (!res.ok) {
		throw new Error(data?.error?.message || `Anthropic API error (${res.status})`);
	}
	// Response content is an array of blocks; concatenate the text ones.
	const text = Array.isArray(data?.content)
		? data.content.filter((b: { type?: string }) => b?.type === 'text').map((b: { text: string }) => b.text).join('')
		: '';
	return text;
}

async function callOpenAI(key: string, req: AiRequest): Promise<string> {
	const res = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: req.model,
			max_tokens: req.maxTokens ?? 2048,
			messages: [
				{ role: 'system', content: req.system },
				...req.messages.map((m) => ({ role: m.role, content: m.content }))
			]
		})
	});

	const data = await res.json().catch(() => null);
	if (!res.ok) {
		throw new Error(data?.error?.message || `OpenAI API error (${res.status})`);
	}
	return data?.choices?.[0]?.message?.content ?? '';
}

export const POST: RequestHandler = async ({ request }) => {
	const key = request.headers.get('x-ai-key');
	if (!key) {
		return new Response(JSON.stringify({ error: 'Missing AI API key' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let body: AiRequest;
	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!body.model || !Array.isArray(body.messages)) {
		return new Response(JSON.stringify({ error: 'Missing model or messages' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const text =
			body.provider === 'openai'
				? await callOpenAI(key, body)
				: await callAnthropic(key, body);
		return new Response(JSON.stringify({ text }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		return new Response(
			JSON.stringify({ error: e instanceof Error ? e.message : 'AI request failed' }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
