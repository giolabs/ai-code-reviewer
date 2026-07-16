import chalk from 'chalk';
import type { GitHubClient } from './github.js';
import { PromptBuilder } from './prompts.js';
import { LearningsStore } from './learnings-store.js';
import type {
  BotCommandParseResult,
  FeedbackConfig,
  FeedbackEvent,
  FeedbackEvaluationResult,
  FeedbackHandleResult,
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
  private readonly learningsStore: LearningsStore;

  constructor(options: FeedbackHandlerOptions) {
    this.githubClient = options.githubClient;
    this.config = options.config;
    this.llmCall = options.llmCall;
    this.promptBuilder = new PromptBuilder();
    this.learningsStore = new LearningsStore();
  }

  async handle(event: FeedbackEvent): Promise<FeedbackHandleResult> {
    const NO_REVIEW: FeedbackHandleResult = { triggerReview: false };

    if (!this.isFeedbackEnabled()) return NO_REVIEW;
    if (this.isBot(event.actor)) return NO_REVIEW;

    const parsed = this.parseBotCommand(event.commentBody);

    if (parsed.command === 'unknown') return NO_REVIEW;

    if (parsed.command === 'approved') {
      await this.handleApproved(event);
      return NO_REVIEW;
    }

    // learn/ask need no parent finding and work from either source.
    if (parsed.command === 'learn') {
      await this.handleLearn(event, parsed.reviewText ?? '');
      return NO_REVIEW;
    }
    if (parsed.command === 'ask') {
      await this.handleAsk(event, parsed.reviewText ?? '');
      return NO_REVIEW;
    }

    if (event.source === 'issue_comment') {
      if (parsed.command === 'review') {
        return this.handleGeneralReview(event, parsed.reviewText ?? '');
      }

      const msg =
        this.config.language === 'es'
          ? `\`@botai ${parsed.command}\` solo funciona en respuestas a comentarios inline del diff. Usá \`@botai approved\`, \`@botai review\` o \`@botai ask\` desde un comentario general.`
          : `\`@botai ${parsed.command}\` only works in inline diff thread replies. Use \`@botai approved\`, \`@botai review\`, or \`@botai ask\` from a general PR comment.`;
      await this.postReply(event, msg);
      return NO_REVIEW;
    }

    if (event.inReplyToId === null) return NO_REVIEW;

    const parentComment = await this.githubClient.getReviewComment(
      event.owner,
      event.repo,
      event.inReplyToId,
    );
    if (!parentComment) return NO_REVIEW;

    const metadata = this.githubClient.extractFindingMetadata(parentComment.body);
    if (!metadata) return NO_REVIEW;

    if (parsed.command === 'review') {
      await this.handleReview({
        event,
        metadata,
        parentBody: parentComment.body,
        reviewText: parsed.reviewText ?? '',
      });
    } else if (parsed.command === 'dismiss') {
      await this.handleDismiss({
        event,
        metadata,
        parentBody: parentComment.body,
        reason: parsed.reviewText ?? '',
      });
    } else if (parsed.command === 'explain') {
      await this.handleExplain({ event, metadata, parentBody: parentComment.body });
    } else {
      await this.handleResolved({ event, metadata, parentBody: parentComment.body });
    }

    return NO_REVIEW;
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
    const match = /@botai\s+(approved|review|resolved|dismiss|explain|learn|ask)/i.exec(body);
    if (!match) return { command: 'unknown' };

    const keyword = match[1].toLowerCase() as Exclude<BotCommandParseResult['command'], 'unknown'>;

    if (keyword === 'review' || keyword === 'dismiss' || keyword === 'learn' || keyword === 'ask') {
      const textMatch = /"""\s*([\s\S]+?)\s*"""/.exec(body);
      return { command: keyword, reviewText: textMatch?.[1] ?? '' };
    }

    return { command: keyword };
  }

  /**
   * `@botai review` posted as a general PR comment (not a reply to a specific
   * inline finding). Unlike the inline `review` command — which evaluates one
   * finding against a code window — this re-runs the full PR review, feeding
   * the developer's own explanation (either quoted with `"""..."""` in this
   * same comment, or written in earlier general comments since the bot's last
   * review) into the model as extra context, so it can recognize when a
   * previously flagged concern is now addressed instead of repeating it.
   */
  private async handleGeneralReview(event: FeedbackEvent, reviewText: string): Promise<FeedbackHandleResult> {
    const feedback = await this.gatherDeveloperFeedback(event, reviewText);

    const replyBody =
      this.config.language === 'es'
        ? `Re-revisando el PR${feedback ? ' teniendo en cuenta tu feedback' : ''}...`
        : `Re-reviewing the PR${feedback ? ' with your feedback in mind' : ''}...`;
    await this.postReply(event, replyBody);

    if (!feedback) {
      return { triggerReview: true };
    }

    const extraInstructions =
      this.config.language === 'es'
        ? `El desarrollador respondió al review anterior con el siguiente feedback. Si un finding ya fue atendido o la observación no aplica según esta respuesta, no lo repitas — explicá brevemente por qué en el resumen en su lugar.\n\n${feedback}`
        : `The developer responded to the previous review with the following feedback. If a finding is already addressed or does not apply per this response, do not repeat it — briefly explain why in the summary instead.\n\n${feedback}`;

    return { triggerReview: true, extraInstructions };
  }

  /**
   * Collects the reviewText quoted in the triggering comment plus every
   * human general comment posted since the bot's last review summary, so a
   * bare `@botai review` (context left in an earlier comment) still works.
   */
  private async gatherDeveloperFeedback(event: FeedbackEvent, reviewText: string): Promise<string> {
    const parts: string[] = [];
    if (reviewText) parts.push(reviewText);

    const summaryCommentId = await this.githubClient.findBotSummaryCommentId(
      event.owner,
      event.repo,
      event.pullNumber,
    );
    const summaryComment =
      summaryCommentId !== 0
        ? await this.githubClient.getIssueComment(event.owner, event.repo, summaryCommentId)
        : null;
    const sinceTimestamp = summaryComment ? Date.parse(summaryComment.updatedAt) : 0;

    const allComments = await this.githubClient.getPullRequestGeneralComments(
      event.owner,
      event.repo,
      event.pullNumber,
    );

    for (const c of allComments) {
      if (c.id === event.commentId) continue;
      if (this.isBot(c.user)) continue;
      if (Date.parse(c.createdAt) < sinceTimestamp) continue;
      parts.push(`@${c.user}: ${c.body}`);
    }

    return parts.join('\n\n---\n\n');
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
    reason: string;
  }): Promise<void> {
    const { event, metadata, parentBody, reason } = args;

    const replyBody =
      this.config.language === 'es'
        ? `Descartado como falso positivo por @${event.actor}. No se volverá a reportar este hallazgo.`
        : `Dismissed as a false positive by @${event.actor}. This finding will not be reported again.`;

    await this.postReply(event, replyBody);
    await this.markStatus({ event, metadata, parentBody, status: FindingStatus.Dismissed });

    // metadata.id is the finding fingerprint — suppress it permanently within this PR (Axis 2).
    await this.githubClient.addSuppressedFingerprint({
      owner: event.owner,
      repo: event.repo,
      pullNumber: event.pullNumber,
      fingerprint: metadata.id,
    });

    console.log(chalk.dim(`@botai dismiss: finding ${metadata.id} descartado y suprimido.`));

    // Repo-level Learnings (opt-in): auto-capture so the same pattern doesn't
    // recur fresh in a future PR, in addition to the per-PR suppression above.
    if (this.config.learnings?.enabled) {
      const findingText = this.extractFindingTextFromBody(parentBody);
      const summary = reason
        ? `${findingText.title} — ${reason}`
        : `Dismissed: ${findingText.title} (${metadata.file})`;
      await this.saveLearning({ event, text: summary });
    }
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

  /** `@botai learn """rule"""` — general comment or inline, no parent finding required. */
  private async handleLearn(event: FeedbackEvent, text: string): Promise<void> {
    if (!this.config.learnings?.enabled) {
      await this.postReply(
        event,
        this.config.language === 'es'
          ? 'La funcionalidad de Learnings no está habilitada (`learnings.enabled: false` en `.ai-review.yml`).'
          : 'The Learnings feature is not enabled (`learnings.enabled: false` in `.ai-review.yml`).',
      );
      return;
    }

    if (!text) {
      await this.postReply(
        event,
        this.config.language === 'es'
          ? 'Usá `@botai learn """tu regla en lenguaje natural"""`.'
          : 'Use `@botai learn """your rule in natural language"""`.',
      );
      return;
    }

    await this.saveLearning({ event, text });
  }

  /** Shared by `handleLearn` (explicit) and `handleDismiss` (auto-capture). */
  private async saveLearning(args: { event: FeedbackEvent; text: string }): Promise<void> {
    const { event, text } = args;

    const ctx = await this.githubClient.getPullRequestContext(event.owner, event.repo, event.pullNumber);
    if (!ctx) {
      await this.postReply(
        event,
        this.config.language === 'es'
          ? 'No se pudo obtener el contexto del PR para guardar el aprendizaje.'
          : 'Could not fetch PR context to save the learning.',
      );
      return;
    }

    const entry = LearningsStore.formatEntry({
      text,
      actor: event.actor,
      pullNumber: event.pullNumber,
      date: new Date().toISOString().slice(0, 10),
    });

    const saved = await this.learningsStore.append({
      githubClient: this.githubClient,
      owner: event.owner,
      repo: event.repo,
      baseRefName: ctx.baseRefName,
      entry,
      maxChars: this.config.learnings!.maxChars,
    });

    const msg = saved
      ? this.config.language === 'es'
        ? `Aprendizaje guardado en \`.ai-review-learnings.md\` (rama \`${ctx.baseRefName}\`). Se va a tener en cuenta en las próximas reviews de este repo.`
        : `Learning saved to \`.ai-review-learnings.md\` (branch \`${ctx.baseRefName}\`). It'll apply to future reviews in this repo.`
      : this.config.language === 'es'
        ? 'No se pudo guardar el aprendizaje (conflicto al commitear). Probá de nuevo.'
        : "Couldn't save the learning (commit conflict). Try again.";

    await this.postReply(event, msg);
    console.log(chalk.dim(`@botai learn: ${saved ? 'guardado' : 'falló al guardar'} — "${text}"`));
  }

  /** `@botai ask """question"""` — general-purpose Q&A, never triggers a re-review. */
  private async handleAsk(event: FeedbackEvent, question: string): Promise<void> {
    if (!question) {
      await this.postReply(
        event,
        this.config.language === 'es'
          ? 'Usá `@botai ask """tu pregunta"""`.'
          : 'Use `@botai ask """your question"""`.',
      );
      return;
    }

    const { contextKind, context } = await this.gatherAskContext(event);

    const prompt = this.promptBuilder.buildAskPrompt({
      question,
      contextKind,
      context,
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
    console.log(chalk.dim('@botai ask: respondido.'));
  }

  private async gatherAskContext(
    event: FeedbackEvent,
  ): Promise<{ contextKind: 'file-window' | 'pr-summary'; context: string }> {
    if (event.inReplyToId !== null) {
      const parentComment = await this.githubClient.getReviewComment(event.owner, event.repo, event.inReplyToId);
      if (parentComment?.line) {
        const fileContent = await this.githubClient.getFileAtRef({
          owner: event.owner,
          repo: event.repo,
          path: parentComment.path,
          ref: event.headSha ?? 'HEAD',
        });
        return { contextKind: 'file-window', context: this.extractLineWindow(fileContent, parentComment.line) };
      }
    }

    const summaryCommentId = await this.githubClient.findBotSummaryCommentId(event.owner, event.repo, event.pullNumber);
    const summaryComment =
      summaryCommentId !== 0 ? await this.githubClient.getIssueComment(event.owner, event.repo, summaryCommentId) : null;

    return { contextKind: 'pr-summary', context: summaryComment?.body ?? '' };
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
