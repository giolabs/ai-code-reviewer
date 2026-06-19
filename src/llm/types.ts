export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface LLMConfig {
  provider: ProviderName;
  model: string;
  ollamaUrl?: string;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  tokensUsed?: { prompt: number; completion: number; total: number };
}

export abstract class LLMAdapter {
  abstract readonly provider: ProviderName;
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  abstract review(args: { systemPrompt: string; userPrompt: string }): Promise<LLMResponse>;

  abstract validateConfig(): void;
}
