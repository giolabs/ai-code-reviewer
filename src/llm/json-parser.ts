import type { ReviewResult, ReviewFinding, RegressionRisk } from '../types.js';

const REQUIRED_FIELDS = ['summary', 'findings', 'recommendation'] as const;

interface FindingRaw {
  file: unknown;
  line: unknown;
  severity: unknown;
  category: unknown;
  title: unknown;
  description: unknown;
  suggestion: unknown;
}

interface RegressionRiskRaw {
  file: unknown;
  symbol: unknown;
  reason: unknown;
}

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
        ? (obj.findings as FindingRaw[]).map((f) => this.mapFinding(f))
        : [],
      anticipatedBugs: Array.isArray(obj.anticipatedBugs)
        ? (obj.anticipatedBugs as FindingRaw[]).map((f) => this.mapFinding(f))
        : [],
      regressionRisks: Array.isArray(obj.regressionRisks)
        ? (obj.regressionRisks as RegressionRiskRaw[]).map((r) => this.mapRegressionRisk(r))
        : [],
    };
  }

  private mapFinding(f: FindingRaw): ReviewFinding {
    return {
      file: (f.file as string) ?? '',
      line: (f.line as number) ?? 0,
      severity: (f.severity as ReviewFinding['severity']) ?? 'info',
      category: (f.category as ReviewFinding['category']) ?? 'maintainability',
      title: (f.title as string) ?? '',
      description: (f.description as string) ?? '',
      suggestion: f.suggestion ? (f.suggestion as string) : undefined,
    };
  }

  private mapRegressionRisk(r: RegressionRiskRaw): RegressionRisk {
    return {
      file: (r.file as string) ?? '',
      symbol: (r.symbol as string) ?? '',
      reason: (r.reason as string) ?? '',
    };
  }
}
