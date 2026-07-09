import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  GitHubClient,
  buildFindingMetadata,
  getReviewCommentEventFromEnv,
  getPullRequestContextFromEnv,
  buildDiffLineMap,
} from '../src/github.js';
import type { ChangedFile } from '../src/types.js';
import { FindingStatus } from '../src/types.js';
import type { ReviewFinding } from '../src/types.js';

// ---------------------------------------------------------------------------
// Shared temp-file helpers
// ---------------------------------------------------------------------------

let tempDir: string | null = null;

function writeTempEvent(payload: object): string {
  if (!tempDir) {
    tempDir = mkdtempSync(join(tmpdir(), 'github-test-'));
  }
  const filePath = join(tempDir, 'event.json');
  writeFileSync(filePath, JSON.stringify(payload), 'utf-8');
  return filePath;
}

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

// ---------------------------------------------------------------------------
// getReviewCommentEventFromEnv
// ---------------------------------------------------------------------------

describe('getReviewCommentEventFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('should return null when GITHUB_REPOSITORY is not set', () => {
    // Arrange
    vi.stubEnv('GITHUB_REPOSITORY', '');
    vi.stubEnv('GITHUB_EVENT_PATH', '/some/path');

    // Act
    const result = getReviewCommentEventFromEnv();

    // Assert
    expect(result).toBeNull();
  });

  it('should return null when GITHUB_EVENT_PATH points to a missing file', () => {
    // Arrange
    vi.stubEnv('GITHUB_REPOSITORY', 'my-org/my-repo');
    vi.stubEnv('GITHUB_EVENT_PATH', '/nonexistent/path/event.json');

    // Act
    const result = getReviewCommentEventFromEnv();

    // Assert
    expect(result).toBeNull();
  });

  it('should return parsed event when the event file contains a valid pull_request_review_comment', () => {
    // Arrange
    const payload = {
      comment: { id: 200, body: '/explain', in_reply_to_id: 100 },
      pull_request: { number: 5 },
      sender: { login: 'dev-user' },
    };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_REPOSITORY', 'my-org/my-repo');
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getReviewCommentEventFromEnv();

    // Assert
    expect(result).toEqual({
      actor: 'dev-user',
      commentId: 200,
      commentBody: '/explain',
      inReplyToId: 100,
      pullNumber: 5,
      owner: 'my-org',
      repo: 'my-repo',
    });
  });

  it('should return null inReplyToId when the comment has no in_reply_to_id field', () => {
    // Arrange
    const payload = {
      comment: { id: 300, body: 'just a comment' },
      pull_request: { number: 7 },
      sender: { login: 'another-user' },
    };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_REPOSITORY', 'my-org/my-repo');
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getReviewCommentEventFromEnv();

    // Assert
    expect(result?.inReplyToId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getPullRequestContextFromEnv
// ---------------------------------------------------------------------------

describe('getPullRequestContextFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('should return null when GITHUB_REPOSITORY is not set', () => {
    // Arrange
    vi.stubEnv('GITHUB_REPOSITORY', '');
    vi.stubEnv('GITHUB_EVENT_PATH', '/some/path');

    // Act
    const result = getPullRequestContextFromEnv();

    // Assert
    expect(result).toBeNull();
  });

  it('should return a PullRequestContext when the event file contains a valid pull_request payload', () => {
    // Arrange
    const payload = {
      pull_request: {
        number: 42,
        title: 'Fix auth bug',
        body: 'Fixes the login crash',
        head: { sha: 'abc123def456' },
        base: { sha: '111222333444' },
      },
    };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_REPOSITORY', 'my-org/my-repo');
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getPullRequestContextFromEnv();

    // Assert
    expect(result).toEqual({
      owner: 'my-org',
      repo: 'my-repo',
      pullNumber: 42,
      headSha: 'abc123def456',
      baseSha: '111222333444',
      title: 'Fix auth bug',
      body: 'Fixes the login crash',
    });
  });

  it('should return null when the event payload has no pull_request field', () => {
    // Arrange
    const payload = { action: 'created', comment: { id: 1, body: 'hello' } };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_REPOSITORY', 'my-org/my-repo');
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getPullRequestContextFromEnv();

    // Assert
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildDiffLineMap
// ---------------------------------------------------------------------------

describe('buildDiffLineMap', () => {
  it('should return an empty map when given no changed files', () => {
    // Arrange
    const files: ChangedFile[] = [];

    // Act
    const result = buildDiffLineMap(files);

    // Assert
    expect(result.size).toBe(0);
  });

  it('should include all added line numbers for a single changed file', () => {
    // Arrange
    const files: ChangedFile[] = [
      {
        path: 'src/auth.ts',
        status: 'modified',
        patch: '@@ -1,3 +1,4 @@\n line1\n line2\n+added line\n line3',
        additions: 1,
        deletions: 0,
      },
    ];

    // Act
    const result = buildDiffLineMap(files);

    // Assert
    expect(result.get('src/auth.ts')).toEqual(new Set([3]));
  });

  it('should build a separate line set for each file path', () => {
    // Arrange
    const files: ChangedFile[] = [
      {
        path: 'src/a.ts',
        status: 'modified',
        patch: '@@ -1,1 +1,2 @@\n line1\n+new line',
        additions: 1,
        deletions: 0,
      },
      {
        path: 'src/b.ts',
        status: 'added',
        patch: '@@ -0,0 +1,1 @@\n+only line',
        additions: 1,
        deletions: 0,
      },
    ];

    // Act
    const result = buildDiffLineMap(files);

    // Assert
    expect(result.get('src/a.ts')).toEqual(new Set([2]));
    expect(result.get('src/b.ts')).toEqual(new Set([1]));
  });
});
