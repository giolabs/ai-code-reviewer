import type { GitHubClient } from './github.js';
import { PromptBuilder } from './prompts.js';
import type { FeedbackConfig, FeedbackEvent, FindingMetadata, ReviewerConfig } from './types.js';
import { FindingStatus, SlashCommand } from './types.js';

const BOT_ACTOR = 'github-actions[bot]';

interface FeedbackHandlerOptions {
  githubClient: GitHubClient;
  config: ReviewerConfig;
  llmCall: (prompt: string) => Promise<string>;
}

export class FeedbackHandler {
  private readonly githubClient: GitHubClient;
  private readonly config: ReviewerConfig;
  private readonly llmCall: (prompt: string) => Promise<string>;
  private readonly promptBuilder: PromptBuilder;

  constructor(options: FeedbackHandlerOptions) {
    this.githubClient = options.githubClient;
    this.config = options.config;
    this.llmCall = options.llmCall;
    this.promptBuilder = new PromptBuilder();
  }

  async handle(event: FeedbackEvent): Promise<void> {
    if (!this.isFeedbackEnabled()) return;
    if (this.isBot(event.actor)) return;

    const command = this.parseSlashCommand(event.commentBody);
    if (command === SlashCommand.Unknown) return;

    if (event.inReplyToId === null) return;

    const parentComment = await this.githubClient.getReviewComment(
      event.owner,
      event.repo,
      event.inReplyToId,
    );
    if (!parentComment) return;

    const metadata = this.githubClient.extractFindingMetadata(parentComment.body);
    if (!metadata) return;

    if (command === SlashCommand.Explain) {
      await this.handleExplain({ event, metadata, parentBody: parentComment.body });
    } else {
      await this.handleDismiss({ event, metadata, parentBody: parentComment.body });
    }
  }

  private isFeedbackEnabled(): boolean {
    const feedbackConfig = this.getFeedbackConfig();
    return feedbackConfig.enabled;
  }

  private getFeedbackConfig(): FeedbackConfig {
    return this.config.feedback ?? { enabled: false, allowDismiss: true };
  }

  private isBot(actor: string): boolean {
    return actor === BOT_ACTOR || actor === process.env.GITHUB_ACTOR;
  }

  private parseSlashCommand(body: string): SlashCommand {
    const trimmed = body.trim();
    if (trimmed.startsWith('/explain')) return SlashCommand.Explain;
    if (trimmed.startsWith('/dismiss')) return SlashCommand.Dismiss;
    return SlashCommand.Unknown;
  }

  private async handleExplain(args: {
    event: FeedbackEvent;
    metadata: FindingMetadata;
    parentBody: string;
  }): Promise<void> {
    const { event, metadata } = args;

    const codeContext = this.extractCodeContextFromBody(args.parentBody);

    const prompt = this.promptBuilder.buildExplainPrompt({
      findingMessage: metadata.file,
      filePath: metadata.file,
      line: metadata.line,
      severity: metadata.severity,
      codeContext,
      language: this.config.language,
    });

    let explanation: string;
    try {
      explanation = await this.llmCall(prompt);
    } catch {
      await this.postReply(event, this.explainErrorMessage());
      return;
    }

    await this.postReply(event, explanation);
  }

  private async handleDismiss(args: {
    event: FeedbackEvent;
    metadata: FindingMetadata;
    parentBody: string;
  }): Promise<void> {
    const { event, metadata, parentBody } = args;

    const feedbackConfig = this.getFeedbackConfig();
    if (!feedbackConfig.allowDismiss) {
      await this.postReply(event, this.dismissDisabledMessage());
      return;
    }

    if (metadata.status !== FindingStatus.Open) {
      await this.postReply(event, this.alreadyResolvedMessage());
      return;
    }

    const updatedMetadata: FindingMetadata = {
      ...metadata,
      status: FindingStatus.Dismissed,
      dismissedBy: event.actor,
    };

    const updatedBody = this.githubClient.embedFindingMetadata(parentBody, updatedMetadata);

    await this.githubClient.editComment({
      owner: event.owner,
      repo: event.repo,
      commentId: event.inReplyToId!,
      body: updatedBody,
      isPrReviewComment: true,
    });

    if (metadata.threadNodeId) {
      await this.githubClient.resolveThread({ threadNodeId: metadata.threadNodeId });
    }

    await this.postReply(event, this.dismissalMessage(event.actor));
  }

  private async postReply(event: FeedbackEvent, body: string): Promise<void> {
    await this.githubClient.postReply({
      owner: event.owner,
      repo: event.repo,
      pullNumber: event.pullNumber,
      commentId: event.inReplyToId!,
      body,
    });
  }

  private extractCodeContextFromBody(commentBody: string): string {
    const withoutMeta = commentBody.replace(/<!-- ai-review-finding:[\s\S]*?-->/, '').trim();
    return withoutMeta.slice(0, 1000);
  }

  private dismissalMessage(actor: string): string {
    return this.config.language === 'es'
      ? `Hallazgo descartado por @${actor}. Hilo resuelto.`
      : `Finding dismissed by @${actor}. Thread resolved.`;
  }

  private dismissDisabledMessage(): string {
    return this.config.language === 'es'
      ? 'El descarte de hallazgos está deshabilitado en la configuración.'
      : 'Dismissing findings is disabled in the project configuration.';
  }

  private alreadyResolvedMessage(): string {
    return this.config.language === 'es'
      ? 'Este hallazgo ya fue resuelto o descartado.'
      : 'This finding has already been resolved or dismissed.';
  }

  private explainErrorMessage(): string {
    return this.config.language === 'es'
      ? 'No se pudo generar la explicación. Intentá de nuevo.'
      : 'Could not generate explanation. Please try again.';
  }
}
