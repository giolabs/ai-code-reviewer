import chalk from 'chalk';
import { ConfigLoader } from './config.js';
import { GitHubClient, getReviewCommentEventFromEnv } from './github.js';
import { FeedbackHandler } from './feedback-handler.js';
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

  const rawEvent = getReviewCommentEventFromEnv();
  if (!rawEvent) {
    throw new Error(
      'No pull_request_review_comment event detected. This command must run in GitHub Actions on a pull_request_review_comment event.',
    );
  }

  if (rawEvent.inReplyToId === null) {
    console.log(chalk.dim('Comment is not a reply to an existing comment. Ignoring.'));
    return;
  }

  const event: FeedbackEvent = {
    actor: rawEvent.actor,
    commentId: rawEvent.commentId,
    commentBody: rawEvent.commentBody,
    inReplyToId: rawEvent.inReplyToId,
    pullNumber: rawEvent.pullNumber,
    repo: rawEvent.repo,
    owner: rawEvent.owner,
  };

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

  await handler.handle(event);
  console.log(chalk.green('✓ Feedback handled.'));
}
