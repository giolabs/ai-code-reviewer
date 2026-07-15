import chalk from 'chalk';
import { ConfigLoader } from './config.js';
import { GitHubClient, getReviewCommentEventFromEnv, getIssueCommentEventFromEnv } from './github.js';
import { FeedbackHandler } from './feedback-handler.js';
import { reviewPullRequest } from './reviewer.js';
import { createLLMAdapter } from './llm/factory.js';
import type { FeedbackEvent } from './types.js';

export async function handleFeedback(): Promise<void> {
  const cwd = process.cwd();
  const configLoader = new ConfigLoader({ cwd });
  const config = configLoader.loadConfig();

  const feedbackConfig = config.feedback;
  if (!feedbackConfig?.enabled) {
    console.log(chalk.dim('Feedback feature is not enabled (feedback.enabled: false). Exiting.'));
    return;
  }

  const reviewCommentEvent = getReviewCommentEventFromEnv();
  const issueCommentEvent = reviewCommentEvent ? null : getIssueCommentEventFromEnv();

  if (!reviewCommentEvent && !issueCommentEvent) {
    throw new Error(
      'No supported event detected. This command must run in GitHub Actions on a pull_request_review_comment or issue_comment event.',
    );
  }

  let event: FeedbackEvent;
  if (reviewCommentEvent) {
    event = {
      actor: reviewCommentEvent.actor,
      commentId: reviewCommentEvent.commentId,
      commentBody: reviewCommentEvent.commentBody,
      inReplyToId: reviewCommentEvent.inReplyToId,
      pullNumber: reviewCommentEvent.pullNumber,
      repo: reviewCommentEvent.repo,
      owner: reviewCommentEvent.owner,
      headSha: reviewCommentEvent.headSha,
      source: 'review_comment',
    };
  } else {
    event = {
      actor: issueCommentEvent!.actor,
      commentId: issueCommentEvent!.commentId,
      commentBody: issueCommentEvent!.commentBody,
      inReplyToId: null,
      pullNumber: issueCommentEvent!.pullNumber,
      repo: issueCommentEvent!.repo,
      owner: issueCommentEvent!.owner,
      source: 'issue_comment',
    };
  }

  const githubClient = new GitHubClient();

  const resolvedModel = config.providerModel ?? config.model;
  const adapter = createLLMAdapter({
    provider: config.provider,
    model: resolvedModel,
    ollamaUrl: config.ollamaUrl,
    temperature: 0.2,
  });

  const handler = new FeedbackHandler({
    githubClient,
    config,
    llmCall: async (prompt: string) => {
      const response = await adapter.review({ systemPrompt: '', userPrompt: prompt });
      return response.content;
    },
  });

  const result = await handler.handle(event);
  console.log(chalk.green('✓ Feedback handled.'));

  if (result.triggerReview) {
    const ctx = await githubClient.getPullRequestContext(event.owner, event.repo, event.pullNumber);
    if (!ctx) {
      console.log(chalk.yellow('⚠ @botai review: no se pudo obtener el contexto del PR, se omite el re-review.'));
      return;
    }

    console.log(chalk.bold('\n@botai review: re-ejecutando el review completo del PR...'));
    await reviewPullRequest({ extraInstructions: result.extraInstructions }, ctx);
  }
}
