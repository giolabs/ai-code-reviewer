import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubClient, buildFindingMetadata } from '../src/github.js';
import { FindingStatus } from '../src/types.js';
import type { ReviewFinding } from '../src/types.js';

function makeReviewFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: 'src/auth.ts',
    line: 42,
    severity: 'major',
    category: 'security',
    title: 'SQL injection risk',
    description: 'User input used directly in query.',
    ...overrides,
  };
}

describe('GitHubClient', () => {
  describe('extractFindingMetadata', () => {
    it('should return metadata when the comment body contains a valid ai-review-finding block', () => {
      // Arrange
      const client = new GitHubClient({ token: 'fake-token' });
      const metadata = { id: 'abc123', file: 'src/foo.ts', line: 10, severity: 'major', status: FindingStatus.Open, dismissedBy: null, commentId: 1, threadNodeId: 'TH_abc' };
      const body = `Some comment text\n<!-- ai-review-finding:${JSON.stringify(metadata)} -->`;

      // Act
      const result = client.extractFindingMetadata(body);

      // Assert
      expect(result).toEqual(metadata);
    });

    it('should return null when the comment body has no ai-review-finding block', () => {
      // Arrange
      const client = new GitHubClient({ token: 'fake-token' });

      // Act
      const result = client.extractFindingMetadata('Just a regular comment with no metadata.');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when the ai-review-finding block contains malformed JSON', () => {
      // Arrange
      const client = new GitHubClient({ token: 'fake-token' });
      const body = '<!-- ai-review-finding:{invalid json} -->';

      // Act
      const result = client.extractFindingMetadata(body);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('embedFindingMetadata', () => {
    it('should append the metadata block to a comment body that has none', () => {
      // Arrange
      const client = new GitHubClient({ token: 'fake-token' });
      const metadata = { id: 'abc123', file: 'src/foo.ts', line: 10, severity: 'major' as const, status: FindingStatus.Open, dismissedBy: null, commentId: 1, threadNodeId: 'TH_abc' };

      // Act
      const result = client.embedFindingMetadata('Comment text', metadata);

      // Assert
      expect(result).toContain('Comment text');
      expect(result).toContain(`<!-- ai-review-finding:${JSON.stringify(metadata)} -->`);
    });

    it('should replace an existing metadata block with the updated one', () => {
      // Arrange
      const client = new GitHubClient({ token: 'fake-token' });
      const oldMetadata = { id: 'abc123', file: 'src/foo.ts', line: 10, severity: 'major' as const, status: FindingStatus.Open, dismissedBy: null, commentId: 1, threadNodeId: 'TH_abc' };
      const newMetadata = { ...oldMetadata, status: FindingStatus.Dismissed, dismissedBy: 'john' };
      const originalBody = `Comment text\n<!-- ai-review-finding:${JSON.stringify(oldMetadata)} -->`;

      // Act
      const result = client.embedFindingMetadata(originalBody, newMetadata);

      // Assert
      expect(result).toContain(`<!-- ai-review-finding:${JSON.stringify(newMetadata)} -->`);
      expect(result).not.toContain(JSON.stringify(oldMetadata));
    });
  });
});

describe('buildFindingMetadata', () => {
  it('should produce a deterministic id from file, line, and title', () => {
    // Arrange
    const finding = makeReviewFinding();

    // Act
    const a = buildFindingMetadata(finding, 1, 'node1');
    const b = buildFindingMetadata(finding, 1, 'node1');

    // Assert
    expect(a.id).toBe(b.id);
  });

  it('should produce different ids for findings with different titles', () => {
    // Arrange
    const finding1 = makeReviewFinding({ title: 'Bug A' });
    const finding2 = makeReviewFinding({ title: 'Bug B' });

    // Act
    const id1 = buildFindingMetadata(finding1, 1, 'n1').id;
    const id2 = buildFindingMetadata(finding2, 1, 'n1').id;

    // Assert
    expect(id1).not.toBe(id2);
  });

  it('should initialize status as open and dismissedBy as null', () => {
    // Arrange
    const finding = makeReviewFinding();

    // Act
    const metadata = buildFindingMetadata(finding, 99, 'TH_xyz');

    // Assert
    expect(metadata.status).toBe('open');
    expect(metadata.dismissedBy).toBeNull();
  });
});
