import { describe, it, expect } from 'vitest';
import { ProjectContextStore, REVIEWER_VERSION } from '../src/project-context.js';
import type { ProjectContext } from '../src/types.js';

function makeContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    tech: 'nextjs',
    appDir: 'site',
    reviewerVersion: REVIEWER_VERSION,
    detectedAt: '2026-07-10T21:36:00.000Z',
    ...overrides,
  };
}

describe('ProjectContextStore', () => {
  describe('serialize', () => {
    it('should include the ai-review-context marker in the output', () => {
      // Arrange
      const store = new ProjectContextStore();
      const context = makeContext();

      // Act
      const result = store.serialize(context);

      // Assert
      expect(result).toContain('<!-- ai-review-context:');
      expect(result).toContain('"tech":"nextjs"');
    });

    it('should include the visible label line', () => {
      // Arrange
      const store = new ProjectContextStore();
      const context = makeContext();

      // Act
      const result = store.serialize(context);

      // Assert
      expect(result).toContain('_🤖 Contexto del proyecto');
    });

    it('should produce output that round-trips through deserialize', () => {
      // Arrange
      const store = new ProjectContextStore();
      const context = makeContext({ tech: 'nestjs', appDir: undefined });

      // Act
      const serialized = store.serialize(context);
      const deserialized = store.deserialize(serialized);

      // Assert
      expect(deserialized).toEqual(context);
    });
  });

  describe('deserialize', () => {
    it('should return null when the marker is absent', () => {
      // Arrange
      const store = new ProjectContextStore();

      // Act
      const result = store.deserialize('some comment body without the marker');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when JSON inside the marker is malformed', () => {
      // Arrange
      const store = new ProjectContextStore();
      const body = '<!-- ai-review-context:{not valid json -->';

      // Act
      const result = store.deserialize(body);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when required field tech is missing', () => {
      // Arrange
      const store = new ProjectContextStore();
      const body = `<!-- ai-review-context:${JSON.stringify({ reviewerVersion: '1.0.0', detectedAt: '2026-01-01T00:00:00.000Z' })} -->`;

      // Act
      const result = store.deserialize(body);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when tech is not a valid TechStack value', () => {
      // Arrange
      const store = new ProjectContextStore();
      const body = `<!-- ai-review-context:${JSON.stringify({ tech: 'angular', reviewerVersion: '1.0.0', detectedAt: '2026-01-01T00:00:00.000Z' })} -->`;

      // Act
      const result = store.deserialize(body);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when reviewerVersion is missing', () => {
      // Arrange
      const store = new ProjectContextStore();
      const body = `<!-- ai-review-context:${JSON.stringify({ tech: 'nextjs', detectedAt: '2026-01-01T00:00:00.000Z' })} -->`;

      // Act
      const result = store.deserialize(body);

      // Assert
      expect(result).toBeNull();
    });

    it('should return ProjectContext on valid input with appDir undefined', () => {
      // Arrange
      const store = new ProjectContextStore();
      const context = makeContext({ appDir: undefined });
      const body = store.serialize(context);

      // Act
      const result = store.deserialize(body);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.tech).toBe('nextjs');
      expect(result?.appDir).toBeUndefined();
    });

    it('should return ProjectContext on valid input with appDir set', () => {
      // Arrange
      const store = new ProjectContextStore();
      const context = makeContext({ appDir: 'site/app' });
      const body = store.serialize(context);

      // Act
      const result = store.deserialize(body);

      // Assert
      expect(result?.appDir).toBe('site/app');
    });
  });

  describe('shouldInvalidate', () => {
    it('should return true when reviewerVersion differs from current', () => {
      // Arrange
      const store = new ProjectContextStore();
      const context = makeContext({ reviewerVersion: '0.0.1-old' });

      // Act
      const result = store.shouldInvalidate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when reviewerVersion matches current', () => {
      // Arrange
      const store = new ProjectContextStore();
      const context = makeContext({ reviewerVersion: REVIEWER_VERSION });

      // Act
      const result = store.shouldInvalidate(context);

      // Assert
      expect(result).toBe(false);
    });
  });
});
