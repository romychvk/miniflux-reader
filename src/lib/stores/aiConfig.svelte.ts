import { storageGetString, storageSet, storageRemove } from '$lib/storage';
import type { AiProvider } from '$lib/types';

const PROVIDER_KEY = 'ai_provider';
const MODEL_KEY = 'ai_model';
const API_KEY = 'ai_api_key';

const DEFAULT_MODELS: Record<AiProvider, string> = {
	anthropic: 'claude-sonnet-4-6',
	openai: 'gpt-4o'
};

function createAiConfig() {
	let provider = $state<AiProvider>('anthropic');
	let model = $state('');
	let apiKey = $state('');
	const isConfigured = $derived(!!apiKey && !!model);

	function init() {
		const p = storageGetString(PROVIDER_KEY);
		provider = p === 'openai' ? 'openai' : 'anthropic';
		model = storageGetString(MODEL_KEY) || DEFAULT_MODELS[provider];
		apiKey = storageGetString(API_KEY);
	}

	function save(next: { provider: AiProvider; model: string; apiKey: string }) {
		provider = next.provider;
		model = next.model.trim() || DEFAULT_MODELS[next.provider];
		apiKey = next.apiKey.trim();
		storageSet(PROVIDER_KEY, provider);
		storageSet(MODEL_KEY, model);
		storageSet(API_KEY, apiKey);
	}

	function clear() {
		provider = 'anthropic';
		model = '';
		apiKey = '';
		storageRemove(PROVIDER_KEY);
		storageRemove(MODEL_KEY);
		storageRemove(API_KEY);
	}

	return {
		get provider() { return provider; },
		get model() { return model; },
		get apiKey() { return apiKey; },
		get isConfigured() { return isConfigured; },
		get defaultModels() { return DEFAULT_MODELS; },
		init,
		save,
		clear
	};
}

export const aiConfig = createAiConfig();
