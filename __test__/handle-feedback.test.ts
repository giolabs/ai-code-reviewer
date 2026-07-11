import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReviewerConfig } from '../src/types.js';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  handle: vi.fn().mockResolvedValue(undefined),
  getReviewCommentEventFromEnv: vi.fn(),
  getIssueCommentEventFromEnv: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  ConfigLoader: vi.fn().mockImplementation(() => ({ loadConfig: mocks.loadConfig })),
}));

vi.mock('../src/github.js', () => ({
  GitHubClient: vi.fn().mockImplementation(() => ({})),
  getReviewCommentEventFromEnv: mocks.getReviewCommentEventFromEnv,
  getIssueCommentEventFromEnv: mocks.getIssueCommentEventFromEnv,
}));

vi.mock('../src/feedback-handler.js', () => ({
  FeedbackHandler: vi.fn().mockImplementation(() => ({ handle: mocks.handle })),
}));

vi.mock('../src/llm/factory.js', () => ({
  createLLMAdapter: vi.fn().mockReturnValue({
    review: vi.fn().mockResolvedValue({ content: '' }),
  }),
}));

import { handleFeedback } from '../src/handle-feedback.js';
import { FeedbackHandler } from '../src/feedback-handler.js';

function makeConfig(overrides: Partial<ReviewerConfig> = {}): ReviewerConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    language: 'es',
    ignore: [],
    minSeverity: 'minor',
    maxFileSize: 100000,
    checks: {
      security: true,
      performance: true,
      maintainability: true,
      testing: true,
      documentation: false,
      style: false,
      'bug-risk': true,
      architecture: true,
    },
    inlineComments: true,
    summaryComment: true,
    maxInlineComments: 20,
    feedback: { enabled: true, allowDismiss: true },
    ...overrides,
  };
}

function makeRawEvent(overrides: { inReplyToId?: number | null } = {}) {
  return {
    actor: 'dev-user',
    commentId: 200,
    commentBody: '/explain',
    inReplyToId: overrides.inReplyToId !== undefined ? overrides.inReplyToId : 100,
    pullNumber: 5,
    repo: 'my-repo',
    owner: 'my-org',
  };
}

describe('handleFeedback', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return without calling FeedbackHandler when feedback is disabled', async () => {
    // Arrange
    mocks.loadConfig.mockReturnValue(
      makeConfig({ feedback: { enabled: false, allowDismiss: true } }),
    );
    mocks.getReviewCommentEventFromEnv.mockReturnValue(makeRawEvent());

    // Act
    await handleFeedback();

    // Assert
    expect(vi.mocked(FeedbackHandler)).not.toHaveBeenCalled();
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it('should throw when neither event type is detected in the environment', async () => {
    // Arrange
    mocks.loadConfig.mockReturnValue(makeConfig());
    mocks.getReviewCommentEventFromEnv.mockReturnValue(null);
    mocks.getIssueCommentEventFromEnv.mockReturnValue(null);

    // Act & Assert
    await expect(handleFeedback()).rejects.toThrow('No supported event detected');
  });

  it('should call FeedbackHandler.handle with review_comment source for pull_request_review_comment events', async () => {
    // Arrange
    mocks.loadConfig.mockReturnValue(makeConfig());
    mocks.getReviewCommentEventFromEnv.mockReturnValue(makeRawEvent({ inReplyToId: 100 }));

    // Act
    await handleFeedback();

    // Assert
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect(mocks.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'dev-user',
        inReplyToId: 100,
        source: 'review_comment',
      }),
    );
  });

  it('should call FeedbackHandler.handle with issue_comment source for general PR comment events', async () => {
    // Arrange
    mocks.loadConfig.mockReturnValue(makeConfig());
    mocks.getReviewCommentEventFromEnv.mockReturnValue(null);
    mocks.getIssueCommentEventFromEnv.mockReturnValue({
      actor: 'lucasgio',
      commentId: 300,
      commentBody: '@botai approved',
      pullNumber: 29,
      repo: 'flowstore',
      owner: 'giolabs',
    });

    // Act
    await handleFeedback();

    // Assert
    expect(mocks.handle).toHaveBeenCalledOnce();
    expect(mocks.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'lucasgio',
        commentBody: '@botai approved',
        inReplyToId: null,
        source: 'issue_comment',
      }),
    );
  });
});
