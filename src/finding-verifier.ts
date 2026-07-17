import type { LLMAdapter } from './llm/types.js';
import type { ReviewFinding, Severity } from './types.js';

interface FindingVerifierDeps {
  adapter: LLMAdapter;
}

interface VerifyArgs {
  findings: ReadonlyArray<ReviewFinding>;
  diffText: string;
  confidenceThreshold: number;
  /** Project authority digest (ADRs / CLAUDE.md) — used to refute intentional-design FPs. */
  projectDigest?: string;
}

interface SurvivorsPayload {
  survivors?: number[];
}

const LOW_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>(['minor', 'info', 'nitpick']);

/**
 * Adversarial self-critique pass (Axis 4). Runs a single extra LLM call that
 * tries to REFUTE each first-pass finding using the cited code, the diff, and
 * optional project authority digest; findings that do not survive are dropped.
 * Then gates low-confidence, low-severity findings. Fail-open: any error keeps
 * the original findings untouched.
 */
export class FindingVerifier {
  constructor(private readonly deps: FindingVerifierDeps) {}

  async verify(args: VerifyArgs): Promise<ReviewFinding[]> {
    const { findings, diffText, confidenceThreshold, projectDigest } = args;
    if (findings.length === 0) return [];

    const survivors = await this.refute({ findings, diffText, projectDigest });
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
    projectDigest?: string;
  }): Promise<ReviewFinding[] | null> {
    const { findings, diffText, projectDigest } = args;

    const systemPrompt = [
      'You are an adversarial reviewer verifying another reviewer\'s findings.',
      'For each finding, try to REFUTE it using the cited code, the diff, and the project authority digest when provided.',
      'A finding survives ONLY if it names a defect that is genuinely present and verifiable NOW.',
      'EXCLUDE (do not list as survivors) findings that:',
      '- ask for docs/tests/comments/placeholders that are already present in the cited code or diff context;',
      '- request scope creep outside the PR (progressive loaders, CloudFront, live network CI, etc.);',
      '- contradict intentional design documented in the project authority digest (e.g. public-read MVP);',
      '- demand non-hermetic CI when hermetic tests or manual ops scripts are already documented;',
      '- are forward-looking ops reminders about environments/origins that do not exist yet.',
      'Default to excluding a finding when you cannot confirm a real defect from the evidence shown.',
      'Return ONLY a JSON object: {"survivors": number[]} listing the 0-based indices of findings that survive.',
    ].join(' ');

    const list = findings
      .map(
        (f, i) =>
          `#${i} [${f.severity}/${f.category}] ${f.title}\nfile: ${f.file}:${f.line}\nwhy: ${f.description}\ncode: ${f.codeRef ?? '(not provided)'}`,
      )
      .join('\n\n');

    const digestBlock = projectDigest
      ? `\n\nProject authority digest (HIGHEST AUTHORITY — contradicting this invalidates a finding):\n${projectDigest.slice(0, 12_000)}`
      : '';

    const userPrompt = `Diff under review:\n\`\`\`diff\n${diffText.slice(0, 40_000)}\n\`\`\`${digestBlock}\n\nFindings to verify:\n${list}\n\nReturn {"survivors": [...]}.`;

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
    let parsed: SurvivorsPayload;
    try {
      parsed = JSON.parse(match[0]) as SurvivorsPayload;
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const survivors = parsed.survivors;
    if (!Array.isArray(survivors)) return null;
    const indices = survivors.filter((n): n is number => typeof n === 'number');
    return new Set(indices);
  }
}
