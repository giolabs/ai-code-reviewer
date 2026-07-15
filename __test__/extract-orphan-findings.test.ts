import { describe, it, expect } from 'vitest';
import { extractOrphanFindings } from '../src/github.js';

describe('extractOrphanFindings', () => {
  it('should return an empty array when no markers are present', () => {
    // Arrange
    const body = '## AI Code Review\n\nAll good, no orphans here.';

    // Act
    const result = extractOrphanFindings(body);

    // Assert
    expect(result).toEqual([]);
  });

  it('should extract a single orphan finding marker', () => {
    // Arrange
    const finding = {
      file: 'apps/backend/src/channels.module.ts',
      line: 0,
      severity: 'major',
      title: 'Bootstrap not guaranteed',
      description: 'The factory provider might not run at bootstrap.',
    };
    const body = `- 🟠 **MAJOR** \`${finding.file}:0\` — ${finding.title}\n<!-- ai-review-orphan:${JSON.stringify(finding)} -->`;

    // Act
    const result = extractOrphanFindings(body);

    // Assert
    expect(result).toEqual([finding]);
  });

  it('should extract multiple orphan finding markers from the same body', () => {
    // Arrange
    const first = { file: 'a.ts', line: 0, severity: 'major', title: 'A', description: 'desc a' };
    const second = { file: 'b.ts', line: 0, severity: 'minor', title: 'B', description: 'desc b' };
    const body = [
      `<!-- ai-review-orphan:${JSON.stringify(first)} -->`,
      `<!-- ai-review-orphan:${JSON.stringify(second)} -->`,
    ].join('\n');

    // Act
    const result = extractOrphanFindings(body);

    // Assert
    expect(result).toEqual([first, second]);
  });

  it('should skip a malformed marker instead of throwing', () => {
    // Arrange
    const body = '<!-- ai-review-orphan:{not valid json -->';

    // Act
    const result = extractOrphanFindings(body);

    // Assert
    expect(result).toEqual([]);
  });

  it('should skip a marker missing required fields', () => {
    // Arrange
    const body = `<!-- ai-review-orphan:${JSON.stringify({ file: 'a.ts' })} -->`;

    // Act
    const result = extractOrphanFindings(body);

    // Assert
    expect(result).toEqual([]);
  });
});
