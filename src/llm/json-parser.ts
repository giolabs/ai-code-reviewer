import type { ReviewResult } from '../types.js';

const REQUIRED_FIELDS = ['summary', 'findings', 'recommendation'] as const;

export function parseReviewJSON(raw: string): ReviewResult {
  // Strategy 1: direct parse
  const direct = tryParse(raw);
  if (direct) return validate(direct);

  // Strategy 2: strip markdown code fences
  const stripped = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
  const fenced = tryParse(stripped);
  if (fenced) return validate(fenced);

  // Strategy 3: extract first {...} substring
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted) return validate(extracted);
  }

  throw new Error(
    `No se pudo parsear la respuesta del LLM como JSON. Respuesta raw: ${raw.slice(0, 200)}`,
  );
}

function tryParse(str: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function validate(obj: Record<string, unknown>): ReviewResult {
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
      ? obj.findings.map((f: Record<string, unknown>) => ({
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
