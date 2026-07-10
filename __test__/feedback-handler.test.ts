import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackHandler } from '../src/feedback-handler.js';
import { FindingStatus, SlashCommand } from '../src/types.js';
import type { FeedbackEvent, FindingMetadata, ReviewerConfig } from '../src/types.js';
import type { GitHubClient } from '../src/github.js';

function makeFeedbackEvent(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    actor: 'dev-user',
    commentId: 200,
    commentBody: '/explain',
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

    it('should exit silently when the comment body has no slash command', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: 'Thanks for the review!' }));

      // Assert
      expect(client.postReply).not.toHaveBeenCalled();
    });

    it('should exit silently when the comment is not a reply (inReplyToId is null)', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ inReplyToId: null }));

      // Assert
      expect(client.postReply).not.toHaveBeenCalled();
    });

    it('should post an explanation reply when /explain is received', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const llmCall = vi.fn().mockResolvedValue('This is the explanation.');
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '/explain' }));

      // Assert
      expect(llmCall).toHaveBeenCalledOnce();
      expect(client.postReply).toHaveBeenCalledOnce();
      const replyArgs = vi.mocked(client.postReply).mock.calls[0][0];
      expect(replyArgs.body).toBe('This is the explanation.');
    });

    it('should resolve the thread and post dismissal message when /dismiss is received', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '/dismiss' }));

      // Assert
      expect(client.editComment).toHaveBeenCalledOnce();
      expect(client.resolveThread).toHaveBeenCalledOnce();
      expect(client.postReply).toHaveBeenCalledOnce();
      const replyArgs = vi.mocked(client.postReply).mock.calls[0][0];
      expect(replyArgs.body).toContain('dev-user');
    });

    it('should not dismiss when allowDismiss is false', async () => {
      // Arrange
      const config = makeConfig({ feedback: { enabled: true, allowDismiss: false } });
      const client = makeGitHubClient();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall: vi.fn() });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '/dismiss' }));

      // Assert
      expect(client.resolveThread).not.toHaveBeenCalled();
      expect(client.editComment).not.toHaveBeenCalled();
      expect(client.postReply).toHaveBeenCalledOnce();
      const replyArgs = vi.mocked(client.postReply).mock.calls[0][0];
      expect(replyArgs.body).toContain('deshabilitado');
    });

    it('should post an error reply when the LLM call fails during /explain', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient();
      const llmCall = vi.fn().mockRejectedValue(new Error('OpenAI timeout'));
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: '/explain' }));

      // Assert
      expect(client.postReply).toHaveBeenCalledOnce();
      const replyArgs = vi.mocked(client.postReply).mock.calls[0][0];
      expect(replyArgs.body).toContain('No se pudo generar');
    });

    it('should call handleFeedbackEvaluation when reply is free-form text', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: vi.fn().mockResolvedValue('const x = 1;\n'),
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({ decision: 'maintained', reply: 'El hallazgo sigue vigente.' }));
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: 'Ya lo arreglé en el commit anterior' }));

      // Assert
      expect(llmCall).toHaveBeenCalledOnce();
      expect(client.postReply).toHaveBeenCalledOnce();
    });
  });

  describe('handleFeedbackEvaluation', () => {
    it('should post reply and resolve thread when decision is resolved', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: vi.fn().mockResolvedValue('const fixed = true;\n'),
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({ decision: 'resolved', reply: 'Gracias, el hallazgo fue resuelto.' }));
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: 'Lo arreglé', headSha: 'abc123' }));

      // Assert
      expect(client.editComment).toHaveBeenCalledOnce();
      expect(client.resolveThread).toHaveBeenCalledOnce();
      expect(client.postReply).toHaveBeenCalledOnce();
      const replyArgs = vi.mocked(client.postReply).mock.calls[0][0];
      expect(replyArgs.body).toBe('Gracias, el hallazgo fue resuelto.');
    });

    it('should post reply only when decision is maintained', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: vi.fn().mockResolvedValue(null),
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({ decision: 'maintained', reply: 'El hallazgo persiste.' }));
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: 'No creo que sea un problema' }));

      // Assert
      expect(client.postReply).toHaveBeenCalledOnce();
      expect(client.editComment).not.toHaveBeenCalled();
      expect(client.resolveThread).not.toHaveBeenCalled();
    });

    it('should return silently when parent comment has no finding metadata', async () => {
      // Arrange
      const config = makeConfig();
      const client = makeGitHubClient(null);
      (client.getFileAtRef as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue(null);
      const llmCall = vi.fn();
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: 'respuesta libre' }));

      // Assert
      expect(llmCall).not.toHaveBeenCalled();
      expect(client.postReply).not.toHaveBeenCalled();
    });

    it('should return silently when LLM returns invalid JSON', async () => {
      // Arrange
      const config = makeConfig();
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: vi.fn().mockResolvedValue('code here'),
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue('not json at all');
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: 'algo' }));

      // Assert
      expect(client.postReply).not.toHaveBeenCalled();
    });

    it('should use HEAD as fallback ref when headSha is absent', async () => {
      // Arrange
      const config = makeConfig();
      const mockGetFileAtRef = vi.fn().mockResolvedValue('file content');
      const client = {
        ...makeGitHubClient(),
        getFileAtRef: mockGetFileAtRef,
      } as unknown as GitHubClient;
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({ decision: 'maintained', reply: 'Persiste.' }));
      const handler = new FeedbackHandler({ githubClient: client, config, llmCall });

      // Act
      await handler.handle(makeFeedbackEvent({ commentBody: 'feedback', headSha: undefined }));

      // Assert
      const callArgs = mockGetFileAtRef.mock.calls[0][0] as { ref: string };
      expect(callArgs.ref).toBe('HEAD');
    });
  });
});
