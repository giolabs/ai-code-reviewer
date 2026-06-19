import { LLMAdapter } from './types.js';
import type { ProviderName, LLMConfig, LLMResponse } from './types.js';
export declare class GeminiAdapter extends LLMAdapter {
    readonly provider: ProviderName;
    private genAI;
    constructor(config: LLMConfig);
    validateConfig(): void;
    review(args: {
        systemPrompt: string;
        userPrompt: string;
    }): Promise<LLMResponse>;
}
