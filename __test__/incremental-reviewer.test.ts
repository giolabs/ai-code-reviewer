import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reviewPullRequest } from '../src/reviewer.js';
import {
  GitHubClient,
  getPullRequestContextFromEnv,
  getPushEventShasFromEnv,
} from '../src/github.js';
import { ThreadResolver } from '../src/thread-resolver.js';
import { createLLMAdapter } from '../src/llm/factory.js';
import { ReviewJsonParser } from '../src/llm/json-parser.js';
import { DependencyGraphIndexer } from '../src/dependency-indexer.js';
import { FindingStatus } from '../src/types.js';
import type { PullRequestContext, FindingMetadata, ChangedFile } from '../src/types.js';

// ---------------------------------------------------------------------------
// Module mocks — cross real boundaries (GitHub API, LLM API)
// ---------------------------------------------------------------------------

vi.mock('../src/github.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/github.js')>();
  return {
    ...actual,
    getPullRequestContextFromEnv: vi.fn(),
    getPushEventShasFromEnv: vi.fn(),
    GitHubClient: vi.fn(),
  };
});

vi.mock('../src/thread-resolver.js', () => ({
  ThreadResolver: vi.fn(),
}));

vi.mock('../src/llm/factory.js', () => ({
  createLLMAdapter: vi.fn(),
}));

vi.mock('../src/llm/json-parser.js', () => ({
  ReviewJsonParser: vi.fn(),
}));

vi.mock('../src/dependency-indexer.js', () => ({
  DependencyGraphIndexer: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePrContext(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    owner: 'org',
    repo: 'repo',
    pullNumber: 1,
    headSha: 'head-sha',
    baseSha: 'base-sha',
    title: 'Fix auth bug',
    body: null,
    ...overrides,
  };
}

function makeCommentWithOpenFinding(): { body: string } {
  const metadata: FindingMetadata = {
    id: 'abc-123',
    file: 'src/auth.ts',
    line: 42,
    severity: 'major',
    status: FindingStatus.Open,
    dismissedBy: null,
    commentId: 99,
    threadNodeId: 'PRRT_abc',
  };
  return {
    body: `**major** · src/auth.ts:42 · SQL injection risk\nUser input in query.\n<!-- ai-review-finding:${JSON.stringify(metadata)} -->`,
  };
}

function makeChangedFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: 'src/auth.ts',
    status: 'modified',
    additions: 3,
    deletions: 1,
    patch: '@@ -1,2 +1,3 @@\n context\n+added line\n context2',
    ...overrides,
  };
}

function makeGitHubClientMock() {
  return {
    getPullRequestReviewComments: vi.fn().mockResolvedValue([]),
    getCompareFiles: vi.fn().mockResolvedValue([]),
    getPullRequestFiles: vi.fn().mockResolvedValue([]),
    postReview: vi.fn().mockResolvedValue(undefined),
    findBotSummaryCommentId: vi.fn().mockResolvedValue(0),
    extractFindingMetadata: vi.fn().mockReturnValue(null),
    listPullRequestReviews: vi.fn().mockResolvedValue([]),
    dismissReview: vi.fn().mockResolvedValue(undefined),
    findContextComment: vi.fn().mockResolvedValue(null),
    createContextComment: vi.fn().mockResolvedValue(undefined),
  };
}

function makeThreadResolverMock() {
  return { resolveFixed: vi.fn().mockResolvedValue(undefined) };
}

// Extracts FindingMetadata embedded in a comment body (mirrors GitHubClient.extractFindingMetadata)
function extractMetadataFromBody(body: string): FindingMetadata | null {
  const match = /<!-- ai-review-finding:(.+?) -->/.exec(body);
  if (!match || !match[1]) return null;
  try { return JSON.parse(match[1]) as FindingMetadata; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reviewPullRequest incremental mode', () => {
  let mockGitHubClient: ReturnType<typeof makeGitHubClientMock>;
  let mockThreadResolver: ReturnType<typeof makeThreadResolverMock>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGitHubClient = makeGitHubClientMock();
    mockThreadResolver = makeThreadResolverMock();

    vi.mocked(GitHubClient).mockImplementation(() => mockGitHubClient as unknown as GitHubClient);
    vi.mocked(ThreadResolver).mockImplementation(() => mockThreadResolver as unknown as ThreadResolver);

    vi.mocked(ReviewJsonParser).mockImplementation(() => ({
      parse: vi.fn().mockReturnValue({ summary: 'ok', findings: [], recommendation: 'comment' }),
    }) as unknown as ReviewJsonParser);

    vi.mocked(DependencyGraphIndexer).mockImplementation(() => ({
      build: vi.fn().mockResolvedValue(null),
    }) as unknown as DependencyGraphIndexer);

    vi.mocked(createLLMAdapter).mockReturnValue({
      review: vi.fn().mockResolvedValue({
        content: JSON.stringify({ summary: 'ok', findings: [], recommendation: 'comment' }),
        tokensUsed: { prompt: 100, completion: 50, total: 150 },
      }),
    } as unknown as ReturnType<typeof createLLMAdapter>);
  });

  it('should run full review when pushShas is null (non-synchronize event)', async () => {
    // Arrange
    vi.mocked(getPullRequestContextFromEnv).mockReturnValue(makePrContext());
    vi.mocked(getPushEventShasFromEnv).mockReturnValue(null);
    mockGitHubClient.getPullRequestFiles.mockResolvedValue([]);

    // Act
    await reviewPullRequest({ dryRun: true });

    // Assert — full review path calls getPullRequestFiles, not getCompareFiles
    expect(mockGitHubClient.getPullRequestFiles).toHaveBeenCalled();
    expect(mockGitHubClient.getCompareFiles).not.toHaveBeenCalled();
  });

  it('should run full review when synchronize event has no prior bot findings', async () => {
    // Arrange
    vi.mocked(getPullRequestContextFromEnv).mockReturnValue(makePrContext());
    vi.mocked(getPushEventShasFromEnv).mockReturnValue({ before: 'aaa', after: 'bbb' });
    mockGitHubClient.getPullRequestReviewComments.mockResolvedValue([]);
    mockGitHubClient.getPullRequestFiles.mockResolvedValue([]);

    // Act
    await reviewPullRequest({ dryRun: true });

    // Assert — falls through to full review because priorFindings is empty
    expect(mockGitHubClient.getPullRequestFiles).toHaveBeenCalled();
    expect(mockGitHubClient.getCompareFiles).not.toHaveBeenCalled();
  });

  it('should run incremental review when synchronize event has prior open bot findings', async () => {
    // Arrange
    vi.mocked(getPullRequestContextFromEnv).mockReturnValue(makePrContext());
    vi.mocked(getPushEventShasFromEnv).mockReturnValue({ before: 'aaa', after: 'bbb' });
    mockGitHubClient.getPullRequestReviewComments.mockResolvedValue([makeCommentWithOpenFinding()]);
    mockGitHubClient.extractFindingMetadata.mockImplementation(extractMetadataFromBody);
    mockGitHubClient.getCompareFiles.mockResolvedValue([]);

    // Act
    await reviewPullRequest({ dryRun: true });

    // Assert — incremental path used: getCompareFiles called, NOT getPullRequestFiles
    expect(mockGitHubClient.getCompareFiles).toHaveBeenCalledWith('org', 'repo', 'aaa', 'bbb');
    expect(mockGitHubClient.getPullRequestFiles).not.toHaveBeenCalled();
  });

  it('should return null without posting when incremental diff is empty', async () => {
    // Arrange
    vi.mocked(getPullRequestContextFromEnv).mockReturnValue(makePrContext());
    vi.mocked(getPushEventShasFromEnv).mockReturnValue({ before: 'aaa', after: 'bbb' });
    mockGitHubClient.getPullRequestReviewComments.mockResolvedValue([makeCommentWithOpenFinding()]);
    mockGitHubClient.extractFindingMetadata.mockImplementation(extractMetadataFromBody);
    mockGitHubClient.getCompareFiles.mockResolvedValue([]);

    // Act
    const result = await reviewPullRequest({ dryRun: true });

    // Assert — no review posted, result is null
    expect(mockGitHubClient.postReview).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('should call ThreadResolver.resolveFixed on the incremental path', async () => {
    // Arrange
    vi.mocked(getPullRequestContextFromEnv).mockReturnValue(makePrContext());
    vi.mocked(getPushEventShasFromEnv).mockReturnValue({ before: 'aaa', after: 'bbb' });
    mockGitHubClient.getPullRequestReviewComments.mockResolvedValue([makeCommentWithOpenFinding()]);
    mockGitHubClient.extractFindingMetadata.mockImplementation(extractMetadataFromBody);
    mockGitHubClient.getCompareFiles.mockResolvedValue([makeChangedFile()]);

    // Act
    await reviewPullRequest({ dryRun: true });

    // Assert — ThreadResolver.resolveFixed was called on the incremental path
    expect(mockThreadResolver.resolveFixed).toHaveBeenCalled();
  });
});
