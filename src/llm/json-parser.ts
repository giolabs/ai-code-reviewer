import type { ReviewResult } from '../types.js';

const REQUIRED_FIELDS = ['summary', 'findings', 'recommendation'] as const;

export class ReviewJsonParser {
  parse(raw: string): ReviewResult {
    const direct = this.tryParse(raw);
    if (direct) return this.validate(direct);

    // Strip markdown code fences
    const stripped = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    const fenced = this.tryParse(stripped);
    if (fenced) return this.validate(fenced);

    // Extract first {...} substring
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const extracted = this.tryParse(match[0]);
      if (extracted) return this.validate(extracted);
    }

    throw new Error(
      `No se pudo parsear la respuesta del LLM como JSON. Respuesta raw: ${raw.slice(0, 200)}`,
    );
  }

  private tryParse(str: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(str);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  private validate(obj: Record<string, unknown>): ReviewResult {
    const missing = REQUIRED_FIELDS.filter((f) => !(f in obj));
    if (missing.length > 0) {
      throw new Error(
        `La respuesta del LLM no tiene la estructura esperada. Campos faltantes: ${missing.join(', ')}`,
      );
    }

    return {
      summary: obj.summary as string,
      overallScore: typeof obj.overallScore === 'number' ? obj.overallScore : undefined,
      recommendation: obj.recommendation as ReviewResult['recommendation'],
      findings: Array.isArray(obj.findings)
        ? (obj.findings as Record<string, unknown>[]).map((f) => ({
            file: (f.file as string) ?? '',
            line: (f.line as number) ?? 0,
            severity: (f.severity as string) ?? 'info',
            category: (f.category as string) ?? 'maintainability',
            title: (f.title as string) ?? '',
            description: (f.description as string) ?? '',
            suggestion: f.suggestion ? (f.suggestion as string) : undefined,
          }))
        : [],
    } as ReviewResult;
  }
}
