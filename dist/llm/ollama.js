import { LLMAdapter } from './types.js';
export class OllamaAdapter extends LLMAdapter {
    provider = 'ollama';
    baseUrl;
    constructor(config) {
        super(config);
        this.validateConfig();
        this.baseUrl = config.ollamaUrl ?? 'http://localhost:11434';
    }
    validateConfig() {
        if (!this.config.model) {
            throw new Error('Modelo requerido para Ollama. Especificalo en providerModel o model en tu .ai-review.yml.');
        }
    }
    async review(args) {
        const url = `${this.baseUrl}/api/chat`;
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.config.model,
                    messages: [
                        {
                            role: 'system',
                            content: args.systemPrompt +
                                '\n\nResponde UNICAMENTE con JSON valido, sin markdown ni texto adicional.',
                        },
                        { role: 'user', content: args.userPrompt },
                    ],
                    stream: false,
                    options: {
                        temperature: this.config.temperature ?? 0.2,
                    },
                }),
                signal: AbortSignal.timeout(120_000),
            });
        }
        catch (err) {
            if (err instanceof TypeError || err.name === 'TypeError') {
                throw new Error(`No se pudo conectar a Ollama en ${this.baseUrl}. Asegurate de que el servicio este corriendo.`);
            }
            throw err;
        }
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Ollama respondio con status ${response.status}: ${body.slice(0, 200)}`);
        }
        const data = (await response.json());
        const content = data.message?.content;
        if (!content) {
            throw new Error('Ollama no devolvio contenido en la respuesta.');
        }
        return {
            content,
            tokensUsed: data.prompt_eval_count != null && data.eval_count != null
                ? {
                    prompt: data.prompt_eval_count,
                    completion: data.eval_count,
                    total: data.prompt_eval_count + data.eval_count,
                }
                : undefined,
        };
    }
}
