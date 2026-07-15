import OpenAI from 'openai';
import { LLMAdapter } from './types.js';
import type { ProviderName, LLMConfig, LLMResponse } from './types.js';

const REVIEW_SCHEMA = {
  name: 'code_review',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: {
        type: 'string',
        description: 'Resumen ejecutivo del review en lenguaje natural, 2-5 oraciones.',
      },
      overallScore: {
        type: 'number',
        description: 'Score general de 0 a 10. 10 = excelente, 0 = no merge bajo ningun concepto.',
      },
      recommendation: {
        type: 'string',
        enum: ['approve', 'comment', 'request_changes'],
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file: { type: 'string' },
            line: { type: 'integer' },
            severity: {
              type: 'string',
              enum: ['critical', 'major', 'minor', 'info', 'nitpick'],
            },
            category: {
              type: 'string',
              enum: [
                'security',
                'performance',
                'maintainability',
                'testing',
                'documentation',
                'style',
                'bug-risk',
                'architecture',
              ],
            },
            title: { type: 'string' },
            description: { type: 'string' },
            suggestion: { type: 'string' },
            codeRef: {
              type: 'string',
              description: 'Exact code snippet (new side of the diff) the finding refers to.',
            },
            confidence: {
              type: 'number',
              description: 'Confidence the finding is real, 0 (guess) to 1 (certain).',
            },
          },
          required: [
            'file',
            'line',
            'severity',
            'category',
            'title',
            'description',
            'suggestion',
            'codeRef',
            'confidence',
          ],
        },
      },
      anticipatedBugs: {
        type: 'array',
        description: 'Bugs not present yet but likely to surface given these changes.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file: { type: 'string' },
            line: { type: 'integer' },
            severity: {
              type: 'string',
              enum: ['critical', 'major', 'minor', 'info', 'nitpick'],
            },
            category: {
              type: 'string',
              enum: [
                'security',
                'performance',
                'maintainability',
                'testing',
                'documentation',
                'style',
                'bug-risk',
                'architecture',
              ],
            },
            title: { type: 'string' },
            description: { type: 'string' },
            suggestion: { type: 'string' },
            codeRef: {
              type: 'string',
              description: 'Exact code snippet (new side of the diff) the finding refers to.',
            },
            confidence: {
              type: 'number',
              description: 'Confidence the finding is real, 0 (guess) to 1 (certain).',
            },
          },
          required: [
            'file',
            'line',
            'severity',
            'category',
            'title',
            'description',
            'suggestion',
            'codeRef',
            'confidence',
          ],
        },
      },
      regressionRisks: {
        type: 'array',
        description: 'Callers or consumers of the changed code that may break.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file: { type: 'string' },
            symbol: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['file', 'symbol', 'reason'],
        },
      },
    },
    required: ['summary', 'overallScore', 'recommendation', 'findings', 'anticipatedBugs', 'regressionRisks'],
  },
} as const;

export class OpenAIAdapter extends LLMAdapter {
  readonly provider: ProviderName = 'openai';
  private client: OpenAI;

  constructor(config: LLMConfig) {
    super(config);
    this.validateConfig();
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  validateConfig(): void {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'OPENAI_API_KEY no esta definida. Agregala como secret en tu repo (Settings > Secrets > Actions) y pasala en el bloque env del workflow.',
      );
    }
  }

  async review(args: { systemPrompt: string; userPrompt: string }): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content: args.userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: REVIEW_SCHEMA,
      },
      ...(this.supportsCustomTemperature(this.config.model)
        ? { temperature: this.config.temperature ?? 0.2 }
        : {}),
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error('OpenAI no devolvio contenido en la respuesta.');
    }

    return {
      content: choice.message.content,
      tokensUsed: response.usage
        ? {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  /** Reasoning models (o1/o3/o4/gpt-5 families) only accept the default temperature (1). */
  private supportsCustomTemperature(model: string): boolean {
    return !/^(o1|o3|o4|gpt-5)/i.test(model);
  }
}
