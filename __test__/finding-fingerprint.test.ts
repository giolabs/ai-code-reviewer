import { describe, it, expect } from 'vitest';
import { computeFindingFingerprint } from '../src/github.js';
import type { ReviewFinding } from '../src/types.js';

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: 'a.ts',
    line: 10,
    severity: 'major',
    category: 'bug-risk',
    title: 'Title',
    description: 'Description',
    ...overrides,
  };
}

describe('computeFindingFingerprint', () => {
  it('should stay stable when the line shifts but the referenced code is the same', () => {
    // Arrange
    const first = finding({ line: 10, codeRef: 'const x = y.z()' });
    const shifted = finding({ line: 42, codeRef: 'const x = y.z()' });

    // Act
    const result = computeFindingFingerprint(shifted);

    // Assert
    expect(result).toBe(computeFindingFingerprint(first));
  });

  it('should stay stable when the title is reworded but the referenced code is the same', () => {
    // Arrange
    const first = finding({ title: 'Possible null deref', codeRef: 'a.b.c' });
    const reworded = finding({ title: 'Null pointer risk', codeRef: 'a.b.c' });

    // Act
    const result = computeFindingFingerprint(reworded);

    // Assert
    expect(result).toBe(computeFindingFingerprint(first));
  });

  it('should differ when the referenced code differs', () => {
    // Arrange
    const first = finding({ codeRef: 'foo()' });
    const other = finding({ codeRef: 'bar()' });

    // Act
    const result = computeFindingFingerprint(other);

    // Assert
    expect(result).not.toBe(computeFindingFingerprint(first));
  });
});
