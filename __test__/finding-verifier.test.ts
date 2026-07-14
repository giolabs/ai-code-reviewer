import { describe, it, expect } from 'vitest';
import { FindingVerifier } from '../src/finding-verifier.js';
import type { LLMAdapter, LLMResponse } from '../src/llm/types.js';
import type { ReviewFinding } from '../src/types.js';

function makeAdapter(review: () => Promise<LLMResponse>): LLMAdapter {
  return { provider: 'openai', review, validateConfig: () => {} } as unknown as LLMAdapter;
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
});
