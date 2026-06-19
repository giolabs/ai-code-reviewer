import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
const DEFAULT_MODELS = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-5-20250514',
    gemini: 'gemini-2.0-flash',
    ollama: null,
};
export function createLLMAdapter(config) {
    const model = config.model || DEFAULT_MODELS[config.provider];
    if (!model) {
        throw new Error(`Modelo requerido para ${config.provider}. Especificalo en providerModel o model en tu .ai-review.yml.`);
    }
    const resolved = { ...config, model };
    switch (config.provider) {
        case 'openai':
            return new OpenAIAdapter(resolved);
        case 'anthropic':
            return new AnthropicAdapter(resolved);
        case 'gemini':
            return new GeminiAdapter(resolved);
        case 'ollama':
            return new OllamaAdapter(resolved);
        default:
            throw new Error(`Provider '${config.provider}' no soportado. Opciones: openai, anthropic, gemini, ollama`);
    }
}
