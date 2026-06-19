import { LLMAdapter } from './types.js';
import type { ProviderName, LLMConfig, LLMResponse } from './types.js';
export declare class OllamaAdapter extends LLMAdapter {
    readonly provider: ProviderName;
    private baseUrl;
    constructor(config: LLMConfig);
    validateConfig(): void;
    review(args: {
        systemPrompt: string;
        userPrompt: string;
    }): Promise<LLMResponse>;
}
