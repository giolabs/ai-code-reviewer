import { describe, it, expect } from 'vitest';
import { ProjectContextStore, REVIEWER_VERSION } from '../src/project-context.js';
import type { ProjectContext } from '../src/types.js';

function makeContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    tech: 'generic',
    appDir: undefined,
    reviewerVersion: REVIEWER_VERSION,
    detectedAt: '2026-07-10T21:36:00.000Z',
    ...overrides,
  };
}

describe('ProjectContextStore stackMap', () => {
  it('should round-trip a multi-entry stackMap through serialize/deserialize', () => {
    // Arrange
    const store = new ProjectContextStore();
    const context = makeContext({
      stackMap: [
        { dir: 'apps/web', tech: 'flutter' },
        { dir: 'apps/api', tech: 'nestjs' },
        { dir: '.', tech: 'generic' },
      ],
    });

    // Act
    const serialized = store.serialize(context);
    const deserialized = store.deserialize(serialized);

    // Assert
    expect(deserialized).toEqual(context);
  });

  it('should omit stackMap from the result when absent (legacy single-tech cache)', () => {
    // Arrange
    const store = new ProjectContextStore();
    const context = makeContext({ appDir: 'apps/web', tech: 'flutter' });

    // Act
    const serialized = store.serialize(context);
    const deserialized = store.deserialize(serialized);

    // Assert
    expect(deserialized?.stackMap).toBeUndefined();
  });

  it('should reject a stackMap entry with an invalid tech value', () => {
    // Arrange
    const store = new ProjectContextStore();
    const body = `<!-- ai-review-context:${JSON.stringify({
      tech: 'generic',
      reviewerVersion: REVIEWER_VERSION,
      detectedAt: '2026-01-01T00:00:00.000Z',
      stackMap: [{ dir: 'apps/web', tech: 'angular' }],
    })} -->`;

    // Act
    const result = store.deserialize(body);

    // Assert
    expect(result?.stackMap).toBeUndefined();
  });

  it('should reject a stackMap entry missing the dir field', () => {
    // Arrange
    const store = new ProjectContextStore();
    const body = `<!-- ai-review-context:${JSON.stringify({
      tech: 'generic',
      reviewerVersion: REVIEWER_VERSION,
      detectedAt: '2026-01-01T00:00:00.000Z',
      stackMap: [{ tech: 'flutter' }],
    })} -->`;

    // Act
    const result = store.deserialize(body);

    // Assert
    expect(result?.stackMap).toBeUndefined();
  });
});
