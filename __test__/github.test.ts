import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  GitHubClient,
  buildFindingMetadata,
  getReviewCommentEventFromEnv,
  getIssueCommentEventFromEnv,
  getPullRequestContextFromEnv,
  getPushEventShasFromEnv,
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
    expect(result).toMatchObject({
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
        base: { sha: '111222333444', ref: 'develop' },
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
      baseRefName: 'develop',
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
// getPushEventShasFromEnv
// ---------------------------------------------------------------------------

describe('getPushEventShasFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('should return null when the event action is not synchronize', () => {
    // Arrange
    const payload = { action: 'opened', before: 'aaa', after: 'bbb' };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getPushEventShasFromEnv();

    // Assert
    expect(result).toBeNull();
  });

  it('should return null when before or after SHAs are missing from the payload', () => {
    // Arrange
    const payload = { action: 'synchronize' };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getPushEventShasFromEnv();

    // Assert
    expect(result).toBeNull();
  });

  it('should return before and after SHAs when the synchronize payload is valid', () => {
    // Arrange
    const payload = { action: 'synchronize', before: 'abc123', after: 'def456' };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getPushEventShasFromEnv();

    // Assert
    expect(result).toEqual({ before: 'abc123', after: 'def456' });
  });
});

// ---------------------------------------------------------------------------
// GitHubClient.findBotSummaryCommentId (mocked octokit)
// ---------------------------------------------------------------------------

describe('GitHubClient.findBotSummaryCommentId', () => {
  it('should return 0 when no bot summary comment exists', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockListComments = vi.fn().mockResolvedValue({ data: [] });
    (client as unknown as { octokit: { issues: { listComments: typeof mockListComments } } }).octokit = {
      issues: { listComments: mockListComments },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.findBotSummaryCommentId('org', 'repo', 1);

    // Assert
    expect(result).toBe(0);
  });

  it('should return the comment id when a bot summary comment is found', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockListComments = vi.fn().mockResolvedValue({
      data: [
        { id: 10, body: 'Regular comment' },
        { id: 42, body: '## ✨ AI Code Review\n\nSome summary\n<!-- ai-review-summary -->' },
      ],
    });
    (client as unknown as { octokit: { issues: { listComments: typeof mockListComments } } }).octokit = {
      issues: { listComments: mockListComments },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.findBotSummaryCommentId('org', 'repo', 1);

    // Assert
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// GitHubClient.getCompareFiles (mocked octokit)
// ---------------------------------------------------------------------------

describe('GitHubClient.getCompareFiles', () => {
  it('should return an empty array when the compare response has no files', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockCompare = vi.fn().mockResolvedValue({ data: {} });
    (client as unknown as { octokit: { repos: { compareCommitsWithBasehead: typeof mockCompare } } }).octokit = {
      repos: { compareCommitsWithBasehead: mockCompare },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.getCompareFiles('org', 'repo', 'abc', 'def');

    // Assert
    expect(result).toEqual([]);
  });

  it('should return mapped ChangedFile array for a valid compare response', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockCompare = vi.fn().mockResolvedValue({
      data: {
        files: [
          { filename: 'src/auth.ts', status: 'modified', patch: '@@ -1,1 +1,2 @@\n+new line', additions: 1, deletions: 0 },
          { filename: 'src/utils.ts', status: 'added', patch: undefined, additions: 5, deletions: 0 },
        ],
      },
    });
    (client as unknown as { octokit: { repos: { compareCommitsWithBasehead: typeof mockCompare } } }).octokit = {
      repos: { compareCommitsWithBasehead: mockCompare },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.getCompareFiles('org', 'repo', 'abc', 'def');

    // Assert
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ path: 'src/auth.ts', status: 'modified', additions: 1, deletions: 0 });
    expect(result[1]).toMatchObject({ path: 'src/utils.ts', status: 'added', additions: 5, deletions: 0 });
  });
});

// ---------------------------------------------------------------------------
// GitHubClient.findContextComment
// ---------------------------------------------------------------------------

describe('GitHubClient.findContextComment', () => {
  it('should return null when no context comment exists', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockListComments = vi.fn().mockResolvedValue({
      data: [
        { id: 1, body: 'Regular comment' },
        { id: 2, body: '## ✨ AI Code Review\n\nSome summary\n<!-- ai-review-summary -->' },
      ],
    });
    (client as unknown as { octokit: { issues: { listComments: typeof mockListComments } } }).octokit = {
      issues: { listComments: mockListComments },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.findContextComment({ owner: 'org', repo: 'repo', pullNumber: 1 });

    // Assert
    expect(result).toBeNull();
  });

  it('should return the comment body when context marker is found', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const contextBody = '_🤖 Contexto del proyecto — generado automáticamente._\n<!-- ai-review-context:{"tech":"nextjs","reviewerVersion":"1.0.0","detectedAt":"2026-01-01T00:00:00.000Z"} -->';
    const mockListComments = vi.fn().mockResolvedValue({
      data: [
        { id: 1, body: 'Regular comment' },
        { id: 2, body: contextBody },
      ],
    });
    (client as unknown as { octokit: { issues: { listComments: typeof mockListComments } } }).octokit = {
      issues: { listComments: mockListComments },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.findContextComment({ owner: 'org', repo: 'repo', pullNumber: 1 });

    // Assert
    expect(result).toBe(contextBody);
  });

  it('should return null on API error', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockListComments = vi.fn().mockRejectedValue(new Error('API error'));
    (client as unknown as { octokit: { issues: { listComments: typeof mockListComments } } }).octokit = {
      issues: { listComments: mockListComments },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.findContextComment({ owner: 'org', repo: 'repo', pullNumber: 1 });

    // Assert
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GitHubClient.createContextComment
// ---------------------------------------------------------------------------

describe('GitHubClient.createContextComment', () => {
  it('should call issues.createComment with correct args', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockCreateComment = vi.fn().mockResolvedValue({ data: { id: 99 } });
    (client as unknown as { octokit: { issues: { createComment: typeof mockCreateComment } } }).octokit = {
      issues: { createComment: mockCreateComment },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];
    const body = '_🤖 Contexto del proyecto._\n<!-- ai-review-context:{"tech":"react"} -->';

    // Act
    await client.createContextComment({ owner: 'org', repo: 'repo', pullNumber: 5, body });

    // Assert
    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      issue_number: 5,
      body,
    });
  });

  it('should not throw when API call fails', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockCreateComment = vi.fn().mockRejectedValue(new Error('Network error'));
    (client as unknown as { octokit: { issues: { createComment: typeof mockCreateComment } } }).octokit = {
      issues: { createComment: mockCreateComment },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act & Assert
    await expect(
      client.createContextComment({ owner: 'org', repo: 'repo', pullNumber: 1, body: 'context' }),
    ).resolves.toBeUndefined();
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

// ---------------------------------------------------------------------------
// GitHubClient.getFileAtRef
// ---------------------------------------------------------------------------

describe('GitHubClient.getFileAtRef', () => {
  it('should return decoded file content on success', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const rawContent = Buffer.from('const x = 1;\n').toString('base64');
    const mockGetContent = vi.fn().mockResolvedValue({
      data: { type: 'file', content: rawContent },
    });
    (client as unknown as { octokit: { repos: { getContent: typeof mockGetContent } } }).octokit = {
      repos: { getContent: mockGetContent },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.getFileAtRef({ owner: 'org', repo: 'repo', path: 'src/auth.ts', ref: 'abc123' });

    // Assert
    expect(result).toBe('const x = 1;\n');
  });

  it('should return null when the response is a directory (array)', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockGetContent = vi.fn().mockResolvedValue({ data: [] });
    (client as unknown as { octokit: { repos: { getContent: typeof mockGetContent } } }).octokit = {
      repos: { getContent: mockGetContent },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.getFileAtRef({ owner: 'org', repo: 'repo', path: 'src/', ref: 'abc' });

    // Assert
    expect(result).toBeNull();
  });

  it('should return null on API error', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake' });
    const mockGetContent = vi.fn().mockRejectedValue(new Error('404 Not Found'));
    (client as unknown as { octokit: { repos: { getContent: typeof mockGetContent } } }).octokit = {
      repos: { getContent: mockGetContent },
    } as unknown as typeof client['octokit' extends keyof typeof client ? 'octokit' : never];

    // Act
    const result = await client.getFileAtRef({ owner: 'org', repo: 'repo', path: 'missing.ts', ref: 'abc' });

    // Assert
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getReviewCommentEventFromEnv — headSha
// ---------------------------------------------------------------------------

describe('getReviewCommentEventFromEnv headSha', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('should include headSha from pull_request.head.sha', () => {
    // Arrange
    const payload = {
      comment: { id: 200, body: 'text', in_reply_to_id: 100 },
      pull_request: { number: 5, head: { sha: 'deadbeef' } },
      sender: { login: 'dev' },
    };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_REPOSITORY', 'my-org/my-repo');
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getReviewCommentEventFromEnv();

    // Assert
    expect(result?.headSha).toBe('deadbeef');
  });

  it('should default headSha to empty string when pull_request.head is absent', () => {
    // Arrange
    const payload = {
      comment: { id: 201, body: 'text', in_reply_to_id: null },
      pull_request: { number: 6 },
      sender: { login: 'dev' },
    };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_REPOSITORY', 'my-org/my-repo');
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getReviewCommentEventFromEnv();

    // Assert
    expect(result?.headSha).toBe('');
  });
});

describe('GitHubClient.submitApprovalReview', () => {
  it('should call pulls.createReview with event APPROVE and return true', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake-token' });
    const mockCreateReview = vi.fn().mockResolvedValue({});
    (client as unknown as Record<string, unknown>)['octokit'] = {
      pulls: { createReview: mockCreateReview },
    };

    // Act
    const ok = await client.submitApprovalReview({ owner: 'org', repo: 'repo', pullNumber: 1, body: 'LGTM' });

    // Assert
    expect(ok).toBe(true);
    expect(mockCreateReview).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      pull_number: 1,
      event: 'APPROVE',
      body: 'LGTM',
    });
  });

  it('should return false when the API call fails', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake-token' });
    (client as unknown as Record<string, unknown>)['octokit'] = {
      pulls: { createReview: vi.fn().mockRejectedValue(new Error('forbidden')) },
    };

    // Act
    const ok = await client.submitApprovalReview({ owner: 'org', repo: 'repo', pullNumber: 1, body: '' });

    // Assert
    expect(ok).toBe(false);
  });
});

describe('GitHubClient.dismissBotChangesRequestedReviews', () => {
  it('should dismiss only CHANGES_REQUESTED reviews from github-actions bot', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake-token' });
    const mockDismiss = vi.fn().mockResolvedValue({});
    (client as unknown as Record<string, unknown>)['octokit'] = {
      rest: {
        pulls: {
          listReviews: vi.fn().mockResolvedValue({
            data: [
              { id: 1, state: 'CHANGES_REQUESTED', user: { login: 'github-actions[bot]' } },
              { id: 2, state: 'APPROVED', user: { login: 'github-actions[bot]' } },
              { id: 3, state: 'CHANGES_REQUESTED', user: { login: 'human' } },
            ],
          }),
          dismissReview: mockDismiss,
        },
      },
    };

    // Act
    const count = await client.dismissBotChangesRequestedReviews({
      owner: 'org',
      repo: 'repo',
      pullNumber: 1,
      message: 'dismissed',
    });

    // Assert
    expect(count).toBe(1);
    expect(mockDismiss).toHaveBeenCalledOnce();
    expect(mockDismiss).toHaveBeenCalledWith(
      expect.objectContaining({ review_id: 1, message: 'dismissed' }),
    );
  });
});

describe('GitHubClient.countOpenBotFindings', () => {
  it('should return zero when there are no review comments', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake-token' });
    const mockPaginate = {
      iterator: vi.fn().mockReturnValue([{ data: [] }]),
    };
    (client as unknown as Record<string, unknown>)['octokit'] = {
      pulls: { listReviewComments: vi.fn() },
      paginate: mockPaginate,
    };

    // Act
    const result = await client.countOpenBotFindings({ owner: 'org', repo: 'repo', pullNumber: 1 });

    // Assert
    expect(result).toBe(0);
  });

  it('should count only bot comments with open status in their metadata', async () => {
    // Arrange
    const client = new GitHubClient({ token: 'fake-token' });
    const openMeta = JSON.stringify({ id: 'x', file: 'f.ts', line: 1, severity: 'major', status: FindingStatus.Open, dismissedBy: null, commentId: 10, threadNodeId: '' });
    const resolvedMeta = JSON.stringify({ id: 'y', file: 'g.ts', line: 2, severity: 'minor', status: FindingStatus.Resolved, dismissedBy: null, commentId: 11, threadNodeId: '' });
    const mockPaginate = {
      iterator: vi.fn().mockReturnValue([{
        data: [
          { id: 10, node_id: '', body: `text <!-- ai-review-finding:${openMeta} -->`, path: 'f.ts', user: { login: 'github-actions[bot]' }, pull_request_review_id: 1 },
          { id: 11, node_id: '', body: `text <!-- ai-review-finding:${resolvedMeta} -->`, path: 'g.ts', user: { login: 'github-actions[bot]' }, pull_request_review_id: 1 },
          { id: 12, node_id: '', body: `text <!-- ai-review-finding:${openMeta} -->`, path: 'h.ts', user: { login: 'human-dev' }, pull_request_review_id: 2 },
        ],
      }]),
    };
    (client as unknown as Record<string, unknown>)['octokit'] = {
      pulls: { listReviewComments: vi.fn() },
      paginate: mockPaginate,
    };

    // Act
    const result = await client.countOpenBotFindings({ owner: 'org', repo: 'repo', pullNumber: 1 });

    // Assert
    expect(result).toBe(1);
  });
});

describe('getIssueCommentEventFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('should return null when the event has no issue field', () => {
    // Arrange
    const payload = { comment: { id: 1, body: '@botai approved' }, sender: { login: 'dev' } };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_REPOSITORY', 'org/repo');
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getIssueCommentEventFromEnv();

    // Assert
    expect(result).toBeNull();
  });

  it('should return null when the issue is not a pull request', () => {
    // Arrange
    const payload = {
      comment: { id: 1, body: '@botai approved' },
      issue: { number: 5 },
      sender: { login: 'dev' },
    };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_REPOSITORY', 'org/repo');
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getIssueCommentEventFromEnv();

    // Assert
    expect(result).toBeNull();
  });

  it('should return parsed event when the issue is a pull request', () => {
    // Arrange
    const payload = {
      comment: { id: 42, body: '@botai approved' },
      issue: { number: 7, pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/7' } },
      sender: { login: 'lucasgio' },
    };
    const filePath = writeTempEvent(payload);
    vi.stubEnv('GITHUB_REPOSITORY', 'org/repo');
    vi.stubEnv('GITHUB_EVENT_PATH', filePath);

    // Act
    const result = getIssueCommentEventFromEnv();

    // Assert
    expect(result).toMatchObject({
      actor: 'lucasgio',
      commentId: 42,
      commentBody: '@botai approved',
      pullNumber: 7,
      owner: 'org',
      repo: 'repo',
    });
  });
});
