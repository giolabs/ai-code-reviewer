import { describe, it, expect } from 'vitest';
import { FindingVerifier } from '../src/finding-verifier.js';
import type { LLMAdapter, LLMResponse } from '../src/llm/types.js';
import type { ReviewFinding } from '../src/types.js';

interface ReviewPromptArgs {
  systemPrompt: string;
  userPrompt: string;
}

function makeAdapter(review: (req: ReviewPromptArgs) => Promise<LLMResponse>): LLMAdapter {
  return {
    provider: 'openai',
    review,
    validateConfig: () => {},
  } as LLMAdapter;
}

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: 'a.ts',
    line: 1,
    severity: 'major',
    category: 'bug-risk',
    title: 'Title',
    description: 'Description',
    ...overrides,
  };
}

describe('FindingVerifier', () => {
  it('should drop findings the refutation pass does not list as survivors', async () => {
    // Arrange
    const adapter = makeAdapter(async () => ({ content: '{"survivors":[0]}' }));
    const verifier = new FindingVerifier({ adapter });
    const findings = [finding({ title: 'real' }), finding({ title: 'fake' })];

    // Act
    const result = await verifier.verify({ findings, diffText: 'x', confidenceThreshold: 0.6 });

    // Assert
    expect(result.map((f) => f.title)).toEqual(['real']);
  });

  it('should drop low-confidence low-severity findings after verification', async () => {
    // Arrange
    const adapter = makeAdapter(async () => ({ content: '{"survivors":[0,1]}' }));
    const verifier = new FindingVerifier({ adapter });
    const findings = [
      finding({ severity: 'minor', confidence: 0.2 }),
      finding({ severity: 'critical', confidence: 0.2 }),
    ];

    // Act
    const result = await verifier.verify({ findings, diffText: 'x', confidenceThreshold: 0.6 });

    // Assert
    expect(result.map((f) => f.severity)).toEqual(['critical']);
  });

  it('should keep findings when the refutation call fails (fail-open)', async () => {
    // Arrange
    const adapter = makeAdapter(async () => {
      throw new Error('network down');
    });
    const verifier = new FindingVerifier({ adapter });
    const findings = [finding({ severity: 'major', confidence: 0.9 })];

    // Act
    const result = await verifier.verify({ findings, diffText: 'x', confidenceThreshold: 0.6 });

    // Assert
    expect(result).toHaveLength(1);
  });

  it('should include the project digest in the refutation prompt when provided', async () => {
    // Arrange
    let capturedUser = '';
    let capturedSystem = '';
    const adapter = makeAdapter(async (req) => {
      capturedSystem = req.systemPrompt;
      capturedUser = req.userPrompt;
      return { content: '{"survivors":[]}' };
    });
    const verifier = new FindingVerifier({ adapter });
    const digest = '### docs/adr/ADR-016.md\nPublic-read of brand logos is intentional for MVP.';

    // Act
    await verifier.verify({
      findings: [finding()],
      diffText: 'diff',
      confidenceThreshold: 0.6,
      projectDigest: digest,
    });

    // Assert
    expect(capturedSystem).toContain('contradict intentional design');
    expect(capturedUser).toContain('ADR-016');
    expect(capturedUser).toContain('Public-read of brand logos');
  });

  it('should drop a public-read security finding when the model refutes it against the ADR digest (FP-03)', async () => {
    // Arrange
    const adapter = makeAdapter(async () => ({ content: '{"survivors":[]}' }));
    const verifier = new FindingVerifier({ adapter });
    const findings = [
      finding({
        severity: 'minor',
        category: 'security',
        title: 'Bucket policy Principal * is insecure',
        description: 'Document or add CloudFront',
        codeRef: '"Principal": "*"',
        confidence: 0.8,
      }),
    ];

    // Act
    const result = await verifier.verify({
      findings,
      diffText: '+  "Principal": "*"',
      confidenceThreshold: 0.6,
      projectDigest: 'ADR-016: public-read logos MVP without CloudFront is intentional.',
    });

    // Assert
    expect(result).toHaveLength(0);
  });

  it('should drop a missing empty-logoKey test finding when the model refutes it (FP-02)', async () => {
    // Arrange
    const adapter = makeAdapter(async () => ({ content: '{"survivors":[]}' }));
    const verifier = new FindingVerifier({ adapter });
    const findings = [
      finding({
        severity: 'minor',
        category: 'testing',
        title: 'Add empty logoKey edge-case test',
        description: 'Consider testing empty logoKey',
        codeRef: "expect(mapper.resolve('')).toBeUndefined();",
        confidence: 0.7,
      }),
    ];

    // Act
    const result = await verifier.verify({
      findings,
      diffText: "+expect(mapper.resolve('')).toBeUndefined();",
      confidenceThreshold: 0.6,
    });

    // Assert
    expect(result).toHaveLength(0);
  });

  it('should drop a future-staging CORS ops reminder when the model refutes it (OPS-01)', async () => {
    // Arrange
    const adapter = makeAdapter(async () => ({ content: '{"survivors":[]}' }));
    const verifier = new FindingVerifier({ adapter });
    const findings = [
      finding({
        severity: 'minor',
        category: 'security',
        title: 'Add staging CORS origins',
        description: 'When staging exists, update cors.json',
        confidence: 0.75,
      }),
    ];

    // Act
    const result = await verifier.verify({
      findings,
      diffText: '+AllowedOrigins',
      confidenceThreshold: 0.6,
    });

    // Assert
    expect(result).toHaveLength(0);
  });

  it('should drop a progressive-loader docs ask when the model refutes it (FP-01)', async () => {
    // Arrange
    const adapter = makeAdapter(async () => ({ content: '{"survivors":[]}' }));
    const verifier = new FindingVerifier({ adapter });
    const findings = [
      finding({
        severity: 'minor',
        category: 'maintainability',
        title: 'Document props and add loading placeholder',
        description: 'Consider progressive loading skeleton',
        codeRef: '/// Prefers the remote [logoUrl] image',
        confidence: 0.7,
      }),
    ];

    // Act
    const result = await verifier.verify({
      findings,
      diffText: '+/// Prefers the remote [logoUrl]',
      confidenceThreshold: 0.6,
    });

    // Assert
    expect(result).toHaveLength(0);
  });

  it('should drop a live-S3-in-CI ask when the model refutes it (FP-04)', async () => {
    // Arrange
    const adapter = makeAdapter(async () => ({ content: '{"survivors":[]}' }));
    const verifier = new FindingVerifier({ adapter });
    const findings = [
      finding({
        severity: 'minor',
        category: 'testing',
        title: 'Wire verify-public-access.sh into CI',
        description: 'Script is manual only; add live GET to CI',
        confidence: 0.7,
      }),
    ];

    // Act
    const result = await verifier.verify({
      findings,
      diffText: '+# Manual verify — not for Jest hermetic suite',
      confidenceThreshold: 0.6,
      projectDigest: 'README: manual verify script; policy covered by hermetic Jest.',
    });

    // Assert
    expect(result).toHaveLength(0);
  });

  it('should keep a true null-deref bug when the model lists it as a survivor', async () => {
    // Arrange
    const adapter = makeAdapter(async () => ({ content: '{"survivors":[0]}' }));
    const verifier = new FindingVerifier({ adapter });
    const findings = [
      finding({
        severity: 'major',
        category: 'bug-risk',
        title: 'Possible null deref on user.name',
        description: 'user may be null before accessing name.length',
        codeRef: 'return user.name.length;',
        confidence: 0.9,
      }),
    ];

    // Act
    const result = await verifier.verify({
      findings,
      diffText: '+return user.name.length;',
      confidenceThreshold: 0.6,
    });

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].title).toContain('null deref');
  });
});
