import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputFormatter } from '../src/output.js';
import type { ReviewFinding, ReviewResult } from '../src/types.js';

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: 'src/foo.ts',
    line: 10,
    severity: 'minor',
    category: 'maintainability',
    title: 'Issue title',
    description: 'Issue description',
    ...overrides,
  };
}

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    summary: 'Overall code looks good.',
    recommendation: 'comment',
    findings: [],
    ...overrides,
  };
}

describe('OutputFormatter', () => {
  const formatter = new OutputFormatter();

  describe('sortFindings', () => {
    it('should sort findings by severity (critical before minor)', () => {
      // Arrange
      const findings = [
        makeFinding({ severity: 'minor', file: 'a.ts', line: 1 }),
        makeFinding({ severity: 'critical', file: 'b.ts', line: 1 }),
      ];

      // Act
      const result = formatter.sortFindings(findings);

      // Assert
      expect(result[0].severity).toBe('critical');
      expect(result[1].severity).toBe('minor');
    });

    it('should sort by file name when severity is equal', () => {
      // Arrange
      const findings = [
        makeFinding({ severity: 'major', file: 'z.ts', line: 1 }),
        makeFinding({ severity: 'major', file: 'a.ts', line: 1 }),
      ];

      // Act
      const result = formatter.sortFindings(findings);

      // Assert
      expect(result[0].file).toBe('a.ts');
    });

    it('should sort by line when severity and file are equal', () => {
      // Arrange
      const findings = [
        makeFinding({ severity: 'info', file: 'a.ts', line: 20 }),
        makeFinding({ severity: 'info', file: 'a.ts', line: 5 }),
      ];

      // Act
      const result = formatter.sortFindings(findings);

      // Assert
      expect(result[0].line).toBe(5);
    });
  });

  describe('filterBySeverity', () => {
    it('should keep findings at or above the minimum severity', () => {
      // Arrange
      const findings = [
        makeFinding({ severity: 'critical' }),
        makeFinding({ severity: 'major' }),
        makeFinding({ severity: 'minor' }),
        makeFinding({ severity: 'info' }),
        makeFinding({ severity: 'nitpick' }),
      ];

      // Act
      const result = formatter.filterBySeverity(findings, 'minor');

      // Assert
      expect(result.map((f) => f.severity)).toEqual(['critical', 'major', 'minor']);
    });

    it('should return no findings when minSeverity is critical and none are critical', () => {
      // Arrange
      const findings = [makeFinding({ severity: 'major' }), makeFinding({ severity: 'minor' })];

      // Act
      const result = formatter.filterBySeverity(findings, 'critical');

      // Assert
      expect(result).toHaveLength(0);
    });
  });

  describe('toMarkdown', () => {
    it('should include summary and recommendation in output', () => {
      // Arrange
      const result = makeResult({ summary: 'Looks clean.', recommendation: 'approve' });

      // Act
      const md = formatter.toMarkdown(result);

      // Assert
      expect(md).toContain('Looks clean.');
      expect(md).toContain('approve');
    });

    it('should show no-findings message when findings array is empty', () => {
      // Arrange
      const result = makeResult({ findings: [] });

      // Act
      const md = formatter.toMarkdown(result);

      // Assert
      expect(md).toContain('Sin findings');
    });

    it('should include finding title and file in output', () => {
      // Arrange
      const result = makeResult({
        findings: [makeFinding({ title: 'Missing null check', file: 'src/auth.ts', line: 42 })],
      });

      // Act
      const md = formatter.toMarkdown(result);

      // Assert
      expect(md).toContain('Missing null check');
      expect(md).toContain('src/auth.ts');
    });

    it('should include token usage when present', () => {
      // Arrange
      const result = makeResult({
        tokensUsed: { prompt: 100, completion: 50, total: 150 },
      });

      // Act
      const md = formatter.toMarkdown(result);

      // Assert
      expect(md).toContain('150');
    });

    it('should include overall score when present', () => {
      // Arrange
      const result = makeResult({ overallScore: 8 });

      // Act
      const md = formatter.toMarkdown(result);

      // Assert
      expect(md).toContain('8/10');
    });
  });

  describe('print', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should call console.log with the summary text', () => {
      // Arrange
      const result = makeResult({ summary: 'All good here.' });

      // Act
      formatter.print(result);

      // Assert
      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ');
      expect(calls).toContain('All good here.');
    });

    it('should indicate no findings when the list is empty', () => {
      // Arrange
      const result = makeResult({ findings: [] });

      // Act
      formatter.print(result);

      // Assert
      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ');
      expect(calls).toContain('Sin findings');
    });
  });
});
