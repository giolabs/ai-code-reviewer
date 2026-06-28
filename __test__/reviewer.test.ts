import { describe, it, expect, vi } from 'vitest';
import { shouldAutoApprove } from '../src/reviewer.js';
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

describe('shouldAutoApprove', () => {
  describe('returns true', () => {
    it('should return true when all conditions are met', () => {
      // Arrange
      const result = makeResult({ recommendation: 'approve', overallScore: 8, findings: [] });
      const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(true);
    });

    it('should return true when overallScore is absent (score check skipped)', () => {
      // Arrange
      const result = makeResult({ recommendation: 'approve', findings: [] });
      const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(true);
    });
  });

  describe('returns false', () => {
    it('should return false when autoApprove is disabled', () => {
      // Arrange
      const result = makeResult({ recommendation: 'approve', overallScore: 9, findings: [] });
      const config = makeConfig({ autoApprove: { enabled: false, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(false);
    });

    it('should return false when autoApprove is absent from config', () => {
      // Arrange
      const result = makeResult({ recommendation: 'approve', findings: [] });
      const config = makeConfig();

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(false);
    });

    it('should return false when recommendation is request_changes', () => {
      // Arrange
      const result = makeResult({ recommendation: 'request_changes', findings: [] });
      const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(false);
    });

    it('should return false when a major finding exists', () => {
      // Arrange
      const result = makeResult({
        recommendation: 'approve',
        findings: [makeFinding('major')],
      });
      const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(false);
    });

    it('should return false when a critical finding exists', () => {
      // Arrange
      const result = makeResult({
        recommendation: 'approve',
        findings: [makeFinding('critical')],
      });
      const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(false);
    });

    it('should return false when overallScore is below minScore', () => {
      // Arrange
      const result = makeResult({ recommendation: 'approve', overallScore: 5, findings: [] });
      const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(false);
    });
  });

  describe('minor/info/nitpick findings do not block', () => {
    it('should return true when only minor findings exist', () => {
      // Arrange
      const result = makeResult({
        recommendation: 'approve',
        findings: [makeFinding('minor'), makeFinding('info'), makeFinding('nitpick')],
      });
      const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(true);
    });
  });

  describe('score boundary', () => {
    it('should return true when overallScore equals minScore exactly', () => {
      // Arrange
      const result = makeResult({ recommendation: 'approve', overallScore: 7, findings: [] });
      const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(true);
    });

    it('should return false when overallScore is one below minScore', () => {
      // Arrange
      const result = makeResult({ recommendation: 'approve', overallScore: 6, findings: [] });
      const config = makeConfig({ autoApprove: { enabled: true, minScore: 7 } });

      // Act
      const outcome = shouldAutoApprove(result, config);

      // Assert
      expect(outcome).toBe(false);
    });
  });
});
