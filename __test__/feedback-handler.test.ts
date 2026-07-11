import { describe, it, expect, vi } from 'vitest';
import { FeedbackHandler } from '../src/feedback-handler.js';
import { FindingStatus } from '../src/types.js';
import type { FeedbackEvent, FindingMetadata, ReviewerConfig } from '../src/types.js';
import type { GitHubClient } from '../src/github.js';

function makeFeedbackEvent(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    actor: 'dev-user',
    commentId: 200,
    commentBody: '@botai resolved',
    inReplyToId: 100,
    pullNumber: 5,
    repo: 'my-repo',
    owner: 'my-org',
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

function makeGitHubClient(
  metadataToReturn: FindingMetadata | null = makeMetadata(),
): GitHubClient {
  return {
    getReviewComment: vi.fn().mockResolvedValue({
      id: 100,
      nodeId: 'TH_abc',
      body: `Finding description\n<!-- ai-review-finding:${JSON.stringify(metadataToReturn)} -->`,
      path: 'src/auth.ts',
      user: 'github-actions[bot]',
      pullRequestReviewId: 1,
    }),
    extractFindingMetadata: vi.fn().mockReturnValue(metadataToReturn),
    embedFindingMetadata: vi.fn().mockReturnValue('updated-body'),
    editComment: vi.fn().mockResolvedValue(undefined),
    resolveThread: vi.fn().mockResolvedValue(undefined),
    postReply: vi.fn().mockResolvedValue(undefined),
    getFileAtRef: vi.fn().mockResolvedValue(null),
    submitApprovalReview: vi.fn().mockResolvedValue(undefined),
    countOpenBotFindings: vi.fn().mockResolvedValue(0),
  } as unknown as GitHubClient;
}

describe('FeedbackHandler', () => {
  describe('handle', () => {
    it('should exit silently when feedback.enabled is false', async () => {
      // Arrange
      const config = makeConfig({ feedback: { enabled: false, allowDismiss: true } });
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent());

      // Assert
      expect(client.getReviewComment).not.toHaveBeenCalled();
      expect(client.postReply).not.toHaveBeenCalled();
    });

    it('should exit silently when the actor is the bot', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ actor: 'github-actions[bot]' }));

      // Assert
      expect(client.postReply).not.toHaveBeenCalled();
    });

    it('should exit silently when the comment body has no @botai command', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: 'Thanks for the review!' }));

      // Assert
      expect(client.postReply).not.toHaveBeenCalled();
    });

    it('should exit silently when @botai resolved is sent but inReplyToId is null', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ inReplyToId: null, commentBody: '@botai resolved' }));

      // Assert
      expect(client.postReply).not.toHaveBeenCalled();
    });
  });

  describe('@botai approved', () => {
    it('should post a reply and submit an approval review', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai approved', inReplyToId: 100 }));

      // Assert
      expect(client.postReply).toHaveBeenCalledOnce();
      const replyArgs = vi.mocked(client.postReply).mock.calls[0][0];
      expect(replyArgs.body).toContain('dev-user');
      expect(client.submitApprovalReview).toHaveBeenCalledOnce();
    });

    it('should work even when inReplyToId is null', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai approved', inReplyToId: null }));

      // Assert
      expect(client.postReply).toHaveBeenCalledOnce();
      expect(client.submitApprovalReview).toHaveBeenCalledOnce();
    });

    it('should detect @botai approved case-insensitively', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai APPROVED', inReplyToId: null }));

      // Assert
      expect(client.submitApprovalReview).toHaveBeenCalledOnce();
    });
  });

  describe('@botai review', () => {
    it('should call LLM with the text between """ and post the reply', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: vi.fn().mockResolvedValue('const x = 1;\n'),
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({ decision: 'maintained', reply: 'El hallazgo sigue vigente.' }));
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai review """Agregué validación en la línea 42."""' }));

      // Assert
      expect(llmCall).toHaveBeenCalledOnce();
      const promptArg = vi.mocked(llmCall).mock.calls[0][0] as string;
      expect(promptArg).toContain('Agregué validación en la línea 42.');
      expect(client.postReply).toHaveBeenCalledOnce();
    });

    it('should resolve thread when LLM decision is resolved', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: vi.fn().mockResolvedValue('const fixed = true;\n'),
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({ decision: 'resolved', reply: 'Resuelto.' }));
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai review """Fix aplicado."""', headSha: 'abc123' }));

      // Assert
      expect(client.editComment).toHaveBeenCalledOnce();
      expect(client.resolveThread).toHaveBeenCalledOnce();
    });

    it('should not edit comment when LLM decision is maintained', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: vi.fn().mockResolvedValue(null),
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({ decision: 'maintained', reply: 'Persiste.' }));
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai review """No aplica."""' }));

      // Assert
      expect(client.editComment).not.toHaveBeenCalled();
      expect(client.resolveThread).not.toHaveBeenCalled();
    });

    it('should return silently when LLM returns invalid JSON', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: vi.fn().mockResolvedValue(null),
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue('not json');
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai review """text"""' }));

      // Assert
      expect(client.postReply).not.toHaveBeenCalled();
    });

    it('should use HEAD as fallback ref when headSha is absent', async () => {
      // Arrange
      const config = makeConfig();
      const mockGetFileAtRef = vi.fn().mockResolvedValue('code');
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: mockGetFileAtRef,
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({ decision: 'maintained', reply: 'Persiste.' }));
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai review """fix"""', headSha: undefined }));

      // Assert
      const callArgs = mockGetFileAtRef.mock.calls[0][0] as { ref: string };
      expect(callArgs.ref).toBe('HEAD');
    });

    it('should return silently when parent comment has no finding metadata', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient(null);
      const llmCall = vi.fn();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai review """text"""' }));

      // Assert
      expect(llmCall).not.toHaveBeenCalled();
      expect(client.postReply).not.toHaveBeenCalled();
    });
  });

  describe('@botai resolved', () => {
    it('should post a reply, update metadata, and resolve the thread', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai resolved' }));

      // Assert
      expect(client.postReply).toHaveBeenCalledOnce();
      expect(client.editComment).toHaveBeenCalledOnce();
      expect(client.resolveThread).toHaveBeenCalledOnce();
    });

    it('should include the actor name in the reply', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ actor: 'lucasgio', commentBody: '@botai resolved' }));

      // Assert
      const replyArgs = vi.mocked(client.postReply).mock.calls[0][0];
      expect(replyArgs.body).toContain('lucasgio');
    });

    it('should approve the PR when no open bot findings remain after resolution', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        countOpenBotFindings: vi.fn().mockResolvedValue(0),
      } as unknown as GitHubClient;
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai resolved' }));

      // Assert
      expect(client.submitApprovalReview).toHaveBeenCalledOnce();
    });

    it('should NOT approve the PR when open bot findings still remain', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        countOpenBotFindings: vi.fn().mockResolvedValue(2),
      } as unknown as GitHubClient;
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai resolved' }));

      // Assert
      expect(client.submitApprovalReview).not.toHaveBeenCalled();
    });

    it('should return silently when parent comment has no finding metadata', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient(null);
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '@botai resolved' }));

      // Assert
      expect(client.editComment).not.toHaveBeenCalled();
      expect(client.postReply).not.toHaveBeenCalled();
    });
  });
});
