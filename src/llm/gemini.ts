import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMAdapter } from './types.js';
import type { ProviderName, LLMConfig, LLMResponse } from './types.js';

export class GeminiAdapter extends LLMAdapter {
  readonly provider: ProviderName = 'gemini';
  private genAI: GoogleGenerativeAI;

  constructor(config: LLMConfig) {
    super(config);
    this.validateConfig();
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }

  validateConfig(): void {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        'GEMINI_API_KEY no esta definida. Obtene una en aistudio.google.com y agregala como secret en tu repo (Settings > Secrets > Actions).',
      );
    }
  }

  async review(args: { systemPrompt: string; userPrompt: string }): Promise<LLMResponse> {
    const model = this.genAI.getGenerativeModel({
      model: this.config.model,
      generationConfig: {
        temperature: this.config.temperature ?? 0.2,
        responseMimeType: 'application/json',
      },
      systemInstruction:
        args.systemPrompt +
        '\n\nResponde UNICAMENTE con JSON valido, sin markdown ni texto adicional. ' +
        'El JSON debe incluir los campos: summary, overallScore, recommendation, findings, anticipatedBugs y regressionRisks. ' +
        'anticipatedBugs sigue el mismo schema que findings (file, line, severity, category, title, description, suggestion). ' +
        'regressionRisks es un array de { file: string, symbol: string, reason: string }. ' +
        'Ambos pueden ser arrays vacios.',
    });

    const result = await model.generateContent(args.userPrompt);
    const response = result.response;
    const text = response.text();

    if (!text) {
      throw new Error('Gemini no devolvio contenido en la respuesta.');
    }

    const usage = response.usageMetadata;
    return {
      content: text,
      tokensUsed: usage
        ? {
            prompt: usage.promptTokenCount ?? 0,
            completion: usage.candidatesTokenCount ?? 0,
            total: usage.totalTokenCount ?? 0,
          }
        : undefined,
    };
  }
}
