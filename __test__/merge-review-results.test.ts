import { describe, it, expect } from 'vitest';
import { mergeReviewResults } from '../src/reviewer.js';
import type { ReviewResult, StackGroup } from '../src/types.js';

function makeGroup(overrides: Partial<StackGroup> = {}): StackGroup {
  return {
    dir: 'apps/web',
    tech: 'flutter',
    appCwd: '/repo/apps/web',
    files: [],
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

describe('mergeReviewResults', () => {
  it('should return the single result unchanged when there is only one group', () => {
    // Arrange
    const result = makeResult({ summary: 'Solo un grupo.' });
    const entries = [{ group: makeGroup(), result }];

    // Act
    const merged = mergeReviewResults(entries);

    // Assert
    expect(merged).toBe(result);
  });

  it('should pick the worst recommendation across groups', () => {
    // Arrange
    const entries = [
      { group: makeGroup({ dir: 'apps/web' }), result: makeResult({ recommendation: 'approve' }) },
      { group: makeGroup({ dir: 'apps/api', tech: 'nestjs' }), result: makeResult({ recommendation: 'request_changes' }) },
    ];

    // Act
    const merged = mergeReviewResults(entries);

    // Assert
    expect(merged.recommendation).toBe('request_changes');
  });

  it('should use the minimum overallScore across groups', () => {
    // Arrange
    const entries = [
      { group: makeGroup({ dir: 'apps/web' }), result: makeResult({ overallScore: 9 }) },
      { group: makeGroup({ dir: 'apps/api', tech: 'nestjs' }), result: makeResult({ overallScore: 4 }) },
    ];

    // Act
    const merged = mergeReviewResults(entries);

    // Assert
    expect(merged.overallScore).toBe(4);
  });

  it('should leave overallScore undefined when no group reported one', () => {
    // Arrange
    const entries = [
      { group: makeGroup({ dir: 'apps/web' }), result: makeResult() },
      { group: makeGroup({ dir: 'apps/api', tech: 'nestjs' }), result: makeResult() },
    ];

    // Act
    const merged = mergeReviewResults(entries);

    // Assert
    expect(merged.overallScore).toBeUndefined();
  });

  it('should concatenate findings from every group', () => {
    // Arrange
    const finding = {
      file: 'apps/web/lib/main.dart',
      line: 1,
      severity: 'major' as const,
      category: 'bug-risk' as const,
      title: 'Bug',
      description: 'desc',
    };
    const entries = [
      { group: makeGroup({ dir: 'apps/web' }), result: makeResult({ findings: [finding] }) },
      { group: makeGroup({ dir: 'apps/api', tech: 'nestjs' }), result: makeResult({ findings: [] }) },
    ];

    // Act
    const merged = mergeReviewResults(entries);

    // Assert
    expect(merged.findings).toEqual([finding]);
  });

  it('should prefix each group summary with its directory and tech name', () => {
    // Arrange
    const entries = [
      { group: makeGroup({ dir: 'apps/web', tech: 'flutter' }), result: makeResult({ summary: 'Web resumen.' }) },
      { group: makeGroup({ dir: 'apps/api', tech: 'nestjs' }), result: makeResult({ summary: 'API resumen.' }) },
    ];

    // Act
    const merged = mergeReviewResults(entries);

    // Assert
    expect(merged.summary).toContain('### apps/web (Flutter)');
    expect(merged.summary).toContain('### apps/api (NestJS)');
  });
});
