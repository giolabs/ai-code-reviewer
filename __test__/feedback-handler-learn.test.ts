import { describe, it, expect, vi } from 'vitest';
import { FeedbackHandler } from '../src/feedback-handler.js';
import { FindingStatus } from '../src/types.js';
import type { FeedbackEvent, FindingMetadata, ReviewerConfig } from '../src/types.js';
import type { GitHubClient } from '../src/github.js';

function makeFeedbackEvent(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    actor: 'dev-user',
    commentId: 200,
    commentBody: '@botai learn """text"""',
    inReplyToId: null,
    pullNumber: 67,
    repo: 'my-repo',
    owner: 'my-org',
    source: 'issue_comment',
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<FindingMetadata> = {}): FindingMetadata {
  return {
    id: 'abc123',
    file: 'src/auth.ts',
    line: 42,
    severity: 'major',
    status: FindingStatus.Open,
    dismissedBy: null,
    commentId: 100,
    threadNodeId: 'TH_abc',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ReviewerConfig> = {}): ReviewerConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    language: 'es',
    ignore: [],
    minSeverity: 'minor',
    maxFileSize: 100000,
    checks: {
      security: true, performance: true, maintainability: true,
      testing: true, documentation: false, style: false,
      'bug-risk': true, architecture: true,
    },
    inlineComments: true,
    summaryComment: true,
    maxInlineComments: 20,
    feedback: { enabled: true, allowDismiss: true },
    ...overrides,
  };
}

function makeGitHubClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getReviewComment: vi.fn().mockResolvedValue({
      id: 100,
      nodeId: 'TH_abc',
      body: `Finding description\n<!-- ai-review-finding:${JSON.stringify(makeMetadata())} -->`,
      path: 'src/auth.ts',
      line: 42,
      user: 'github-actions[bot]',
      pullRequestReviewId: 1,
    }),
    extractFindingMetadata: vi.fn().mockReturnValue(makeMetadata()),
    embedFindingMetadata: vi.fn().mockReturnValue('updated-body'),
    editComment: vi.fn().mockResolvedValue(undefined),
    resolveThread: vi.fn().mockResolvedValue(undefined),
    postReply: vi.fn().mockResolvedValue(undefined),
    postPullRequestComment: vi.fn().mockResolvedValue(undefined),
    addSuppressedFingerprint: vi.fn().mockResolvedValue(undefined),
    getPullRequestContext: vi.fn().mockResolvedValue({
      owner: 'my-org',
      repo: 'my-repo',
      pullNumber: 67,
      headSha: 'sha',
      baseSha: 'base-sha',
      baseRefName: 'develop',
      title: 'title',
      body: null,
    }),
    getFileWithSha: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as GitHubClient;
}

describe('FeedbackHandler @botai learn', () => {
  it('should reply that the feature is disabled when learnings.enabled is false', async () => {
    // Arrange
    const config = makeConfig();
    const client = makeGitHubClient();
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

    // Act
    await handler.handle(makeFeedbackEvent({ commentBody: '@botai learn """rule"""' }));

    // Assert
    expect(client.getFileWithSha).not.toHaveBeenCalled();
    expect(client.postPullRequestComment).toHaveBeenCalledOnce();
  });

  it('should ask for a rule when the quoted text is empty', async () => {
    // Arrange
    const config = makeConfig({ learnings: { enabled: true, maxChars: 4000 } });
    const client = makeGitHubClient();
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

    // Act
    await handler.handle(makeFeedbackEvent({ commentBody: '@botai learn' }));

    // Assert
    expect(client.createOrUpdateFile).not.toHaveBeenCalled();
    expect(client.postPullRequestComment).toHaveBeenCalledOnce();
  });

  it('should append a learning entry and confirm, from a general comment', async () => {
    // Arrange
    const config = makeConfig({ learnings: { enabled: true, maxChars: 4000 } });
    const client = makeGitHubClient();
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

    // Act
    const result = await handler.handle(
      makeFeedbackEvent({ commentBody: '@botai learn """No reportar console.log en scripts/migrations/**"""' }),
    );

    // Assert
    expect(client.createOrUpdateFile).toHaveBeenCalledOnce();
    expect(client.postPullRequestComment).toHaveBeenCalledOnce();
    expect(result).toEqual({ triggerReview: false });
  });

  it('should work as an inline reply too, without requiring finding metadata', async () => {
    // Arrange
    const config = makeConfig({ learnings: { enabled: true, maxChars: 4000 } });
    const client = { ...makeGitHubClient(), extractFindingMetadata: vi.fn().mockReturnValue(null) } as unknown as GitHubClient;
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

    // Act
    await handler.handle(
      makeFeedbackEvent({
        commentBody: '@botai learn """rule from inline"""',
        source: 'review_comment',
        inReplyToId: 100,
      }),
    );

    // Assert
    expect(client.createOrUpdateFile).toHaveBeenCalledOnce();
  });

  it('should also auto-capture a learning when @botai dismiss is used, in addition to suppressing the fingerprint', async () => {
    // Arrange
    const config = makeConfig({ learnings: { enabled: true, maxChars: 4000 } });
    const client = makeGitHubClient();
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

    // Act
    await handler.handle(
      makeFeedbackEvent({
        commentBody: '@botai dismiss """not applicable to this pattern"""',
        source: 'review_comment',
        inReplyToId: 100,
      }),
    );

    // Assert
    expect(client.addSuppressedFingerprint).toHaveBeenCalledOnce();
    expect(client.createOrUpdateFile).toHaveBeenCalledOnce();
    const call = vi.mocked(client.createOrUpdateFile).mock.calls[0][0] as { content: string };
    expect(call.content).toContain('not applicable to this pattern');
  });

  it('should not auto-capture a dismiss when learnings.enabled is false', async () => {
    // Arrange
    const config = makeConfig();
    const client = makeGitHubClient();
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

    // Act
    await handler.handle(
      makeFeedbackEvent({ commentBody: '@botai dismiss', source: 'review_comment', inReplyToId: 100 }),
    );

    // Assert
    expect(client.addSuppressedFingerprint).toHaveBeenCalledOnce();
    expect(client.createOrUpdateFile).not.toHaveBeenCalled();
  });
});
