import Anthropic from '@anthropic-ai/sdk';
import { LLMAdapter } from './types.js';
export class AnthropicAdapter extends LLMAdapter {
    provider = 'anthropic';
    client;
    constructor(config) {
        super(config);
        this.validateConfig();
        this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    validateConfig() {
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY no esta definida. Obtene una en console.anthropic.com y agregala como secret en tu repo (Settings > Secrets > Actions).');
        }
    }
    async review(args) {
        const response = await this.client.messages.create({
            model: this.config.model,
            max_tokens: 8192,
            system: args.systemPrompt + '\n\nResponde UNICAMENTE con JSON valido, sin markdown ni texto adicional.',
            messages: [{ role: 'user', content: args.userPrompt }],
            temperature: this.config.temperature ?? 0.2,
        });
        const textBlock = response.content.find((b) => b.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
            throw new Error('Anthropic no devolvio contenido de texto en la respuesta.');
        }
        return {
            content: textBlock.text,
            tokensUsed: {
                prompt: response.usage.input_tokens,
                completion: response.usage.output_tokens,
                total: response.usage.input_tokens + response.usage.output_tokens,
            },
        };
    }
}
