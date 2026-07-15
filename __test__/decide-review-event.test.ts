import { describe, it, expect } from 'vitest';
import { decideReviewEvent } from '../src/reviewer.js';
import type { ReviewResult, ReviewerConfig, ReviewFinding } from '../src/types.js';

function makeConfig(overrides: Partial<ReviewerConfig> = {}): ReviewerConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    language: 'es',
    ignore: [],
    minSeverity: 'minor',
    maxFileSize: 100_000,
    checks: {
      security: true,
      performance: true,
      maintainability: true,
      testing: true,
      documentation: false,
      style: false,
      'bug-risk': true,
      architecture: true,
    },
    inlineComments: true,
    summaryComment: true,
    maxInlineComments: 20,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    summary: 'Todo bien.',
    findings: [],
    recommendation: 'approve',
    ...overrides,
  };
}

function makeFinding(severity: ReviewFinding['severity']): ReviewFinding {
  return {
    file: 'src/foo.ts',
    line: 1,
    severity,
    category: 'bug-risk',
    title: 'Test finding',
    description: 'Test description',
  };
}

describe('decideReviewEvent', () => {
  it('should force REQUEST_CHANGES when a major finding is present, even if the model recommends approve', () => {
    // Arrange
    const result = makeResult({
      recommendation: 'approve',
      overallScore: 9,
      findings: [makeFinding('major')],
    });
    const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

    // Act
    const decision = decideReviewEvent(result, config);

    // Assert
    expect(decision).toEqual({ event: 'REQUEST_CHANGES', autoApproved: false, forcedBlock: true });
  });

  it('should force REQUEST_CHANGES when a critical finding is present, regardless of score', () => {
    // Arrange
    const result = makeResult({
      recommendation: 'comment',
      overallScore: 10,
      findings: [makeFinding('critical')],
    });
    const config = makeConfig();

    // Act
    const decision = decideReviewEvent(result, config);

    // Assert
    expect(decision.event).toBe('REQUEST_CHANGES');
  });

  it('should auto-approve when only minor findings are present and the score is above the threshold', () => {
    // Arrange
    const result = makeResult({
      recommendation: 'approve',
      overallScore: 8,
      findings: [makeFinding('minor')],
    });
    const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

    // Act
    const decision = decideReviewEvent(result, config);

    // Assert
    expect(decision).toEqual({ event: 'APPROVE', autoApproved: true, forcedBlock: false });
  });

  it('should fall back to the model recommendation when there are no blocking findings and auto-approve is disabled', () => {
    // Arrange
    const result = makeResult({ recommendation: 'comment', overallScore: 8, findings: [] });
    const config = makeConfig();

    // Act
    const decision = decideReviewEvent(result, config);

    // Assert
    expect(decision).toEqual({ event: 'COMMENT', autoApproved: false, forcedBlock: false });
  });
});
