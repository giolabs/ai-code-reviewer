import chalk from 'chalk';
import type { GitHubClient } from './github.js';
import { PromptBuilder } from './prompts.js';
import type {
  BotCommandParseResult,
  FeedbackConfig,
  FeedbackEvent,
  FeedbackEvaluationResult,
  FindingMetadata,
  ReviewerConfig,
} from './types.js';
import { FindingStatus } from './types.js';

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

    const parsed = this.parseBotCommand(event.commentBody);

    if (parsed.command === 'unknown') return;

    if (parsed.command === 'approved') {
      await this.handleApproved(event);
      return;
    }

    if (event.source === 'issue_comment') {
      const msg =
        this.config.language === 'es'
          ? `\`@botai ${parsed.command}\` solo funciona en respuestas a comentarios inline del diff. Usá \`@botai approved\` desde un comentario general.`
          : `\`@botai ${parsed.command}\` only works in inline diff thread replies. Use \`@botai approved\` from a general PR comment.`;
      await this.postReply(event, msg);
      return;
    }

    if (event.inReplyToId === null) return;

    const parentComment = await this.githubClient.getReviewComment(
      event.owner,
      event.repo,
      event.inReplyToId,
    );
    if (!parentComment) return;

    const metadata = this.githubClient.extractFindingMetadata(parentComment.body);
    if (!metadata) return;

    if (parsed.command === 'review') {
      await this.handleReview({
        event,
        metadata,
        parentBody: parentComment.body,
        reviewText: parsed.reviewText ?? '',
      });
    } else if (parsed.command === 'dismiss') {
      await this.handleDismiss({ event, metadata, parentBody: parentComment.body });
    } else if (parsed.command === 'explain') {
      await this.handleExplain({ event, metadata, parentBody: parentComment.body });
    } else {
      await this.handleResolved({ event, metadata, parentBody: parentComment.body });
    }
  }

  private isFeedbackEnabled(): boolean {
    return this.getFeedbackConfig().enabled;
  }

  private getFeedbackConfig(): FeedbackConfig {
    return this.config.feedback ?? { enabled: false, allowDismiss: true };
  }

  private isBot(actor: string): boolean {
    return actor === BOT_ACTOR;
  }

  private parseBotCommand(body: string): BotCommandParseResult {
    const match = /@botai\s+(approved|review|resolved|dismiss|explain)/i.exec(body);
    if (!match) return { command: 'unknown' };

    const keyword = match[1].toLowerCase() as Exclude<BotCommandParseResult['command'], 'unknown'>;

    if (keyword === 'review') {
      const textMatch = /"""\s*([\s\S]+?)\s*"""/.exec(body);
      return { command: 'review', reviewText: textMatch?.[1] ?? '' };
    }

    return { command: keyword };
  }

  private async handleApproved(event: FeedbackEvent): Promise<void> {
    const replyBody =
      this.config.language === 'es'
        ? `@${event.actor} aprobó este PR. Procediendo a aprobar.`
        : `@${event.actor} approved this PR. Proceeding to approve.`;

    await this.postReply(event, replyBody);

    const approvalBody =
      this.config.language === 'es'
        ? `PR aprobado por @${event.actor} vía @botai.`
        : `PR approved by @${event.actor} via @botai.`;

    await this.githubClient.submitApprovalReview({
      owner: event.owner,
      repo: event.repo,
      pullNumber: event.pullNumber,
      body: approvalBody,
    });

    console.log(chalk.green(`PR aprobado por @${event.actor}.`));
  }

  private async handleReview(args: {
    event: FeedbackEvent;
    metadata: FindingMetadata;
    parentBody: string;
    reviewText: string;
  }): Promise<void> {
    const { event, metadata, parentBody, reviewText } = args;

    const fileContent = await this.githubClient.getFileAtRef({
      owner: event.owner,
      repo: event.repo,
      path: metadata.file,
      ref: event.headSha ?? 'HEAD',
    });

    const fileWindow = this.extractLineWindow(fileContent, metadata.line);
    const findingText = this.extractFindingTextFromBody(parentBody);

    const prompt = this.promptBuilder.buildFeedbackEvaluationPrompt({
      findingTitle: findingText.title,
      findingDescription: findingText.description,
      findingSeverity: metadata.severity,
      findingFile: metadata.file,
      findingLine: metadata.line,
      devReply: reviewText,
      fileWindow,
      language: this.config.language,
    });

    let result: FeedbackEvaluationResult;
    try {
      const raw = await this.llmCall(prompt);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.decision !== 'string' || typeof parsed.reply !== 'string') {
        throw new Error('Invalid LLM response shape');
      }
      result = { decision: parsed.decision as FeedbackEvaluationResult['decision'], reply: parsed.reply };
    } catch {
      return;
    }

    await this.postReply(event, result.reply);

    if (result.decision === 'resolved') {
      await this.markResolved({ event, metadata, parentBody });
    }

    console.log(chalk.dim(`@botai review: ${result.decision}`));
  }

  private async handleResolved(args: {
    event: FeedbackEvent;
    metadata: FindingMetadata;
    parentBody: string;
  }): Promise<void> {
    const { event, metadata, parentBody } = args;

    const replyBody =
      this.config.language === 'es'
        ? `Hallazgo resuelto por @${event.actor}.`
        : `Finding resolved by @${event.actor}.`;

    await this.postReply(event, replyBody);

    await this.markResolved({ event, metadata, parentBody });

    const openCount = await this.githubClient.countOpenBotFindings({
      owner: event.owner,
      repo: event.repo,
      pullNumber: event.pullNumber,
    });

    if (openCount === 0) {
      const approvalBody =
        this.config.language === 'es'
          ? `Todos los hallazgos fueron resueltos. PR aprobado automáticamente.`
          : `All findings resolved. PR automatically approved.`;

      await this.githubClient.submitApprovalReview({
        owner: event.owner,
        repo: event.repo,
        pullNumber: event.pullNumber,
        body: approvalBody,
      });

      console.log(chalk.green('Todos los hallazgos resueltos. PR aprobado.'));
    }
  }

  private async handleDismiss(args: {
    event: FeedbackEvent;
    metadata: FindingMetadata;
    parentBody: string;
  }): Promise<void> {
    const { event, metadata, parentBody } = args;

    const replyBody =
      this.config.language === 'es'
        ? `Descartado como falso positivo por @${event.actor}. No se volverá a reportar este hallazgo.`
        : `Dismissed as a false positive by @${event.actor}. This finding will not be reported again.`;

    await this.postReply(event, replyBody);
    await this.markStatus({ event, metadata, parentBody, status: FindingStatus.Dismissed });

    // metadata.id is the finding fingerprint — suppress it permanently (Axis 2).
    await this.githubClient.addSuppressedFingerprint({
      owner: event.owner,
      repo: event.repo,
      pullNumber: event.pullNumber,
      fingerprint: metadata.id,
    });

    console.log(chalk.dim(`@botai dismiss: finding ${metadata.id} descartado y suprimido.`));
  }

  private async handleExplain(args: {
    event: FeedbackEvent;
    metadata: FindingMetadata;
    parentBody: string;
  }): Promise<void> {
    const { event, metadata, parentBody } = args;

    const fileContent = await this.githubClient.getFileAtRef({
      owner: event.owner,
      repo: event.repo,
      path: metadata.file,
      ref: event.headSha ?? 'HEAD',
    });
    const fileWindow = this.extractLineWindow(fileContent, metadata.line);
    const findingText = this.extractFindingTextFromBody(parentBody);

    const prompt = this.promptBuilder.buildExplainPrompt({
      findingTitle: findingText.title,
      findingDescription: findingText.description,
      findingFile: metadata.file,
      findingLine: metadata.line,
      fileWindow,
      language: this.config.language,
    });

    let reply: string;
    try {
      reply = (await this.llmCall(prompt)).trim();
    } catch {
      return;
    }
    if (!reply) return;

    await this.postReply(event, reply.slice(0, 4000));
    console.log(chalk.dim(`@botai explain: respondido para finding ${metadata.id}.`));
  }

  private async markResolved(args: {
    event: FeedbackEvent;
    metadata: FindingMetadata;
    parentBody: string;
  }): Promise<void> {
    await this.markStatus({ ...args, status: FindingStatus.Resolved });
  }

  private async markStatus(args: {
    event: FeedbackEvent;
    metadata: FindingMetadata;
    parentBody: string;
    status: FindingStatus;
  }): Promise<void> {
    const { event, metadata, parentBody, status } = args;

    const updatedMetadata: FindingMetadata = { ...metadata, status };
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
  }

  private extractLineWindow(fileContent: string | null, line: number): string {
    if (!fileContent) return '';
    const lines = fileContent.split('\n');
    const start = Math.max(0, line - 51);
    const end = Math.min(lines.length, line + 50);
    const window = lines.slice(start, end).join('\n');
    return window.slice(0, 3000);
  }

  private extractFindingTextFromBody(commentBody: string): { title: string; description: string } {
    const markerIndex = commentBody.indexOf('<!-- ai-review-finding:');
    const text = markerIndex === -1 ? commentBody : commentBody.slice(0, markerIndex);
    const trimmed = text.trim();
    const lineBreak = trimmed.indexOf('\n');
    if (lineBreak === -1) return { title: trimmed, description: '' };
    const title = trimmed.slice(0, lineBreak).trim();
    const description = trimmed.slice(lineBreak).trim().slice(0, 500);
    return { title, description };
  }

  private async postReply(event: FeedbackEvent, body: string): Promise<void> {
    if (event.source === 'issue_comment') {
      await this.githubClient.postPullRequestComment({
        owner: event.owner,
        repo: event.repo,
        pullNumber: event.pullNumber,
        body,
      });
      return;
    }
    await this.githubClient.postReply({
      owner: event.owner,
      repo: event.repo,
      pullNumber: event.pullNumber,
      commentId: event.inReplyToId ?? event.commentId,
      body,
    });
  }
}
