import { LLMAdapter } from './types.js';
import type { ProviderName, LLMConfig, LLMResponse } from './types.js';
export declare class OpenAIAdapter extends LLMAdapter {
    readonly provider: ProviderName;
    private client;
    constructor(config: LLMConfig);
    validateConfig(): void;
    review(args: {
        systemPrompt: string;
        userPrompt: string;
    }): Promise<LLMResponse>;
}
