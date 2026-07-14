import type { LLMAdapter } from './llm/types.js';
import type { ReviewFinding, Severity } from './types.js';

interface FindingVerifierDeps {
  adapter: LLMAdapter;
}

interface VerifyArgs {
  findings: ReadonlyArray<ReviewFinding>;
  diffText: string;
  confidenceThreshold: number;
}

const LOW_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>(['minor', 'info', 'nitpick']);

/**
 * Adversarial self-critique pass (Axis 4). Runs a single extra LLM call that
 * tries to REFUTE each first-pass finding using only the cited code; findings
 * that do not survive are dropped. Then gates low-confidence, low-severity
 * findings. Fail-open: any error keeps the original findings untouched.
 */
export class FindingVerifier {
  constructor(private readonly deps: FindingVerifierDeps) {}

  async verify(args: VerifyArgs): Promise<ReviewFinding[]> {
    const { findings, diffText, confidenceThreshold } = args;
    if (findings.length === 0) return [];

    const survivors = await this.refute({ findings, diffText });
    const kept = survivors ?? findings.slice();

    return kept.filter((f) => !this.isWeak(f, confidenceThreshold));
  }

  private isWeak(finding: ReviewFinding, threshold: number): boolean {
    if (typeof finding.confidence !== 'number') return false;
    return finding.confidence < threshold && LOW_SEVERITIES.has(finding.severity);
  }

  private async refute(args: {
    findings: ReadonlyArray<ReviewFinding>;
    diffText: string;
  }): Promise<ReviewFinding[] | null> {
    const { findings, diffText } = args;

    const systemPrompt =
      'You are an adversarial reviewer verifying another reviewer\'s findings. For each finding, try to REFUTE it using only the cited code and the diff. A finding survives only if the described defect is genuinely present. Return ONLY a JSON object: {"survivors": number[]} listing the 0-based indices of findings that survive. Default to excluding a finding when you cannot confirm it from the code shown.';

    const list = findings
      .map(
        (f, i) =>
          `#${i} [${f.severity}/${f.category}] ${f.title}\nfile: ${f.file}:${f.line}\nwhy: ${f.description}\ncode: ${f.codeRef ?? '(not provided)'}`,
      )
      .join('\n\n');

    const userPrompt = `Diff under review:\n\`\`\`diff\n${diffText.slice(0, 40_000)}\n\`\`\`\n\nFindings to verify:\n${list}\n\nReturn {"survivors": [...]}.`;

    try {
      const response = await this.deps.adapter.review({ systemPrompt, userPrompt });
      const indices = this.parseSurvivors(response.content);
      if (indices === null) return null;
      return findings.filter((_, i) => indices.has(i));
    } catch {
      return null;
    }
  }

  private parseSurvivors(raw: string): Set<number> | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const survivors = (parsed as Record<string, unknown>)['survivors'];
    if (!Array.isArray(survivors)) return null;
    const indices = survivors.filter((n): n is number => typeof n === 'number');
    return new Set(indices);
  }
}
