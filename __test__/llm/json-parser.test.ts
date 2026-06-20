import { describe, it, expect } from 'vitest';
import { ReviewJsonParser } from '../../src/llm/json-parser.js';

function makeValidPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: 'Looks good.',
    recommendation: 'comment',
    findings: [],
    ...overrides,
  });
}

describe('ReviewJsonParser', () => {
  const parser = new ReviewJsonParser();

  describe('parse', () => {
    it('should parse a valid JSON string directly', () => {
      // Arrange
      const raw = makeValidPayload({ summary: 'All clean.' });

      // Act
      const result = parser.parse(raw);

      // Assert
      expect(result.summary).toBe('All clean.');
      expect(result.recommendation).toBe('comment');
      expect(result.findings).toHaveLength(0);
    });

    it('should parse JSON wrapped in a markdown code fence', () => {
      // Arrange
      const raw = '```json\n' + makeValidPayload() + '\n```';

      // Act
      const result = parser.parse(raw);

      // Assert
      expect(result.summary).toBe('Looks good.');
    });

    it('should extract JSON embedded in surrounding text', () => {
      // Arrange
      const json = makeValidPayload({ summary: 'Embedded.' });
      const raw = `Here is my review:\n${json}\nEnd of review.`;

      // Act
      const result = parser.parse(raw);

      // Assert
      expect(result.summary).toBe('Embedded.');
    });

    it('should throw when the raw string is not parseable as JSON', () => {
      // Arrange
      const raw = 'This is not JSON at all.';

      // Act & Assert
      expect(() => parser.parse(raw)).toThrow();
    });

    it('should throw when required fields are missing', () => {
      // Arrange
      const raw = JSON.stringify({ summary: 'Only summary, no findings or recommendation.' });

      // Act & Assert
      expect(() => parser.parse(raw)).toThrow('Campos faltantes');
    });

    it('should return an empty findings array when findings is empty', () => {
      // Arrange
      const raw = makeValidPayload({ findings: [] });

      // Act
      const result = parser.parse(raw);

      // Assert
      expect(result.findings).toEqual([]);
    });

    it('should map findings fields from the raw payload', () => {
      // Arrange
      const finding = {
        file: 'src/auth.ts',
        line: 15,
        severity: 'major',
        category: 'security',
        title: 'SQL Injection risk',
        description: 'Unsanitized input passed to query.',
        suggestion: 'Use parameterized queries.',
      };
      const raw = makeValidPayload({ findings: [finding] });

      // Act
      const result = parser.parse(raw);

      // Assert
      expect(result.findings[0].file).toBe('src/auth.ts');
      expect(result.findings[0].severity).toBe('major');
      expect(result.findings[0].suggestion).toBe('Use parameterized queries.');
    });
  });
});
