import { describe, it, expect, vi } from 'vitest';
import { FeedbackHandler } from '../src/feedback-handler.js';
import type { FeedbackEvent, ReviewerConfig } from '../src/types.js';
import type { GitHubClient } from '../src/github.js';

function makeFeedbackEvent(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    actor: 'dev-user',
    commentId: 200,
    commentBody: '@botai ask """question"""',
    inReplyToId: null,
    pullNumber: 67,
    repo: 'my-repo',
    owner: 'my-org',
    source: 'issue_comment',
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
      body: 'some comment',
      path: 'src/auth.ts',
      line: 42,
      user: 'lucasgio',
      pullRequestReviewId: 1,
    }),
    extractFindingMetadata: vi.fn().mockReturnValue(null),
    getFileAtRef: vi.fn().mockResolvedValue('const x = 1;\n'.repeat(60)),
    findBotSummaryCommentId: vi.fn().mockResolvedValue(42),
    getIssueComment: vi.fn().mockResolvedValue({ body: '## AI Code Review\n\nSummary text.', updatedAt: '2026-07-15T00:00:00.000Z' }),
    postReply: vi.fn().mockResolvedValue(undefined),
    postPullRequestComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as GitHubClient;
}

describe('FeedbackHandler @botai ask', () => {
  it('should ask for a question when the quoted text is empty', async () => {
    // Arrange
    const config = makeConfig();
    const client = makeGitHubClient();
    const llmCall = vi.fn();
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

    // Act
    await handler.handle(makeFeedbackEvent({ commentBody: '@botai ask' }));

    // Assert
    expect(llmCall).not.toHaveBeenCalled();
    expect(client.postPullRequestComment).toHaveBeenCalledOnce();
  });

  it('should answer using the PR summary from a general comment', async () => {
    // Arrange
    const config = makeConfig();
    const client = makeGitHubClient();
    const llmCall = vi.fn().mockResolvedValue('This PR adds capability resolution.');
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

    // Act
    const result = await handler.handle(
      makeFeedbackEvent({ commentBody: '@botai ask """what does this PR change?"""' }),
    );

    // Assert
    expect(llmCall).toHaveBeenCalledOnce();
    const prompt = vi.mocked(llmCall).mock.calls[0][0] as string;
    expect(prompt).toContain('what does this PR change?');
    expect(prompt).toContain('Summary text.');
    expect(client.postPullRequestComment).toHaveBeenCalledOnce();
    expect(result).toEqual({ triggerReview: false });
  });

  it('should answer using the surrounding code when replying inline, without requiring finding metadata', async () => {
    // Arrange
    const config = makeConfig();
    const client = makeGitHubClient();
    const llmCall = vi.fn().mockResolvedValue('The factory runs at bootstrap.');
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

    // Act
    await handler.handle(
      makeFeedbackEvent({
        commentBody: '@botai ask """why is this flagged?"""',
        source: 'review_comment',
        inReplyToId: 100,
      }),
    );

    // Assert
    expect(client.extractFindingMetadata).not.toHaveBeenCalled();
    expect(client.getFileAtRef).toHaveBeenCalledOnce();
    const prompt = vi.mocked(llmCall).mock.calls[0][0] as string;
    expect(prompt).toContain('why is this flagged?');
    expect(client.postReply).toHaveBeenCalledOnce();
  });

  it('should not post a reply when the LLM call throws', async () => {
    // Arrange
    const config = makeConfig();
    const client = makeGitHubClient();
    const llmCall = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

    // Act
    await handler.handle(makeFeedbackEvent({ commentBody: '@botai ask """question"""' }));

    // Assert
    expect(client.postPullRequestComment).not.toHaveBeenCalled();
  });

  it('should not post a reply when the LLM returns an empty response', async () => {
    // Arrange
    const config = makeConfig();
    const client = makeGitHubClient();
    const llmCall = vi.fn().mockResolvedValue('   ');
    const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

    // Act
    await handler.handle(makeFeedbackEvent({ commentBody: '@botai ask """question"""' }));

    // Assert
    expect(client.postPullRequestComment).not.toHaveBeenCalled();
  });
});
