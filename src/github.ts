import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import type {
  ChangedFile,
  PullRequestContext,
  ReviewFinding,
  FindingMetadata,
  FindingStatus,
  PushEventShas,
} from './types.js';

// ---------------------------------------------------------------------------
// GitHubClient
// ---------------------------------------------------------------------------

interface GitHubClientOptions {
  token?: string;
}

interface InlineCommentEntry {
  path: string;
  line: number;
  body: string;
  finding: ReviewFinding;
}

interface ReviewThreadNode {
  id: string;
  comments: {
    nodes: Array<{ id: string }>;
  };
}

interface ReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: ReviewThreadNode[];
      };
    };
  };
}

interface PostReviewArgs {
  summary: string;
  findings: ReviewFinding[];
  event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';
  inlineComments: boolean;
  maxInlineComments: number;
  diffLineMap: Map<string, Set<number>>;
}

interface PostReplyOptions {
  owner: string;
  repo: string;
  pullNumber: number;
  commentId: number;
  body: string;
}

interface EditCommentOptions {
  owner: string;
  repo: string;
  commentId: number;
  body: string;
  isPrReviewComment: boolean;
}

interface ResolveThreadOptions {
  threadNodeId: string;
}

interface ListReviewsOptions {
  owner: string;
  repo: string;
  pullNumber: number;
}

interface DismissReviewOptions {
  owner: string;
  repo: string;
  pullNumber: number;
  reviewId: number;
  message: string;
}

export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly graphqlWithAuth: typeof graphql;

  constructor(options: GitHubClientOptions = {}) {
    const token = options.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        'GITHUB_TOKEN is not defined. In GitHub Actions, pass it as an env var:\n' +
          '  env:\n' +
          '    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
      );
    }
    this.octokit = new Octokit({ auth: token });
    this.graphqlWithAuth = graphql.defaults({ headers: { authorization: `token ${token}` } });
  }

  async getPullRequestFiles(ctx: PullRequestContext): Promise<ChangedFile[]> {
    const files: ChangedFile[] = [];

    for await (const response of this.octokit.paginate.iterator(this.octokit.pulls.listFiles, {
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.pullNumber,
      per_page: 100,
    })) {
      for (const file of response.data) {
        files.push({
          path: file.filename,
          status: normalizeStatus(file.status),
          patch: file.patch,
          additions: file.additions,
          deletions: file.deletions,
        });
      }
    }

    return files;
  }

  async getFileContent(
    ctx: PullRequestContext,
    path: string,
    ref: string,
  ): Promise<string | null> {
    try {
      const response = await this.octokit.repos.getContent({
        owner: ctx.owner,
        repo: ctx.repo,
        path,
        ref,
      });

      if (Array.isArray(response.data)) return null;
      if (response.data.type !== 'file') return null;
      if (!('content' in response.data)) return null;

      return Buffer.from(response.data.content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Posts a review on the PR with a summary and inline comments.
   * Returns the created review ID (used as the summary comment ID for later edits).
   */
  async postReview(ctx: PullRequestContext, args: PostReviewArgs): Promise<number> {
    const { summary, findings, event, inlineComments, maxInlineComments, diffLineMap } = args;

    const inline: InlineCommentEntry[] = [];
    const orphans: ReviewFinding[] = [];

    if (inlineComments) {
      for (const f of findings) {
        const fileDiff = diffLineMap.get(f.file);
        if (fileDiff?.has(f.line) && inline.length < maxInlineComments) {
          const placeholderMetadata = buildFindingMetadata(f, 0, '');
          inline.push({
            path: f.file,
            line: f.line,
            body: formatInlineCommentBody(f, placeholderMetadata),
            finding: f,
          });
        } else {
          orphans.push(f);
        }
      }
    } else {
      orphans.push(...findings);
    }

    const finalSummary = composeSummary(summary, orphans);

    const review = await this.octokit.pulls.createReview({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.pullNumber,
      commit_id: ctx.headSha,
      event,
      body: finalSummary,
      comments: inline.map((c) => ({
        path: c.path,
        line: c.line,
        side: 'RIGHT' as const,
        body: c.body,
      })),
    });

    if (inline.length > 0) {
      await this.patchInlineCommentMetadata(ctx, review.data.id, inline);
    }

    return review.data.id;
  }

  private async patchInlineCommentMetadata(
    ctx: PullRequestContext,
    reviewId: number,
    inlineEntries: ReadonlyArray<InlineCommentEntry>,
  ): Promise<void> {
    const reviewCommentsResponse = await this.octokit.pulls.listCommentsForReview({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.pullNumber,
      review_id: reviewId,
      per_page: 100,
    });

    const threads = await this.fetchReviewThreads(ctx.owner, ctx.repo, ctx.pullNumber);

    const threadByCommentNodeId = new Map<string, string>();
    for (const thread of threads) {
      const firstComment = thread.comments.nodes[0];
      if (firstComment) {
        threadByCommentNodeId.set(firstComment.id, thread.id);
      }
    }

    for (const rc of reviewCommentsResponse.data) {
      const entry = inlineEntries.find((e) => e.path === rc.path && e.line === rc.line);
      if (!entry) continue;

      const threadNodeId = threadByCommentNodeId.get(rc.node_id) ?? '';
      const metadata = buildFindingMetadata(entry.finding, rc.id, threadNodeId);
      const newBody = this.embedFindingMetadata(entry.body, metadata);

      await this.octokit.pulls.updateReviewComment({
        owner: ctx.owner,
        repo: ctx.repo,
        comment_id: rc.id,
        body: newBody,
      });
    }
  }

  private async fetchReviewThreads(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<ReadonlyArray<ReviewThreadNode>> {
    const response = await this.graphqlWithAuth<ReviewThreadsResponse>(
      `query GetReviewThreads($owner: String!, $repo: String!, $pullNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pullNumber) {
            reviewThreads(first: 100) {
              nodes {
                id
                comments(first: 1) {
                  nodes { id }
                }
              }
            }
          }
        }
      }`,
      { owner, repo, pullNumber },
    );
    return response.repository.pullRequest.reviewThreads.nodes;
  }

  async postReply(options: PostReplyOptions): Promise<void> {
    await this.octokit.pulls.createReplyForReviewComment({
      owner: options.owner,
      repo: options.repo,
      pull_number: options.pullNumber,
      comment_id: options.commentId,
      body: options.body,
    });
  }

  async editComment(options: EditCommentOptions): Promise<void> {
    if (options.isPrReviewComment) {
      await this.octokit.pulls.updateReviewComment({
        owner: options.owner,
        repo: options.repo,
        comment_id: options.commentId,
        body: options.body,
      });
    } else {
      await this.octokit.issues.updateComment({
        owner: options.owner,
        repo: options.repo,
        comment_id: options.commentId,
        body: options.body,
      });
    }
  }

  async resolveThread(options: ResolveThreadOptions): Promise<void> {
    try {
      await this.graphqlWithAuth(
        `mutation ResolveThread($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread { id isResolved }
          }
        }`,
        { threadId: options.threadNodeId },
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('422')) return;
      throw err;
    }
  }

  async getPullRequestReviewComments(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<PrReviewComment[]> {
    const comments: PrReviewComment[] = [];

    for await (const response of this.octokit.paginate.iterator(
      this.octokit.pulls.listReviewComments,
      {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      },
    )) {
      for (const c of response.data) {
        comments.push({
          id: c.id,
          nodeId: c.node_id,
          body: c.body,
          path: c.path,
          user: c.user?.login ?? '',
          pullRequestReviewId: c.pull_request_review_id ?? null,
        });
      }
    }

    return comments;
  }

  async getReviewComment(
    owner: string,
    repo: string,
    commentId: number,
  ): Promise<PrReviewComment | null> {
    try {
      const { data } = await this.octokit.pulls.getReviewComment({
        owner,
        repo,
        comment_id: commentId,
      });
      return {
        id: data.id,
        nodeId: data.node_id,
        body: data.body,
        path: data.path,
        user: data.user?.login ?? '',
        pullRequestReviewId: data.pull_request_review_id ?? null,
      };
    } catch {
      return null;
    }
  }

  extractFindingMetadata(commentBody: string): FindingMetadata | null {
    const match = /<!-- ai-review-finding:([\s\S]*?)-->/.exec(commentBody);
    if (!match) return null;
    try {
      return JSON.parse(match[1].trim()) as FindingMetadata;
    } catch {
      return null;
    }
  }

  embedFindingMetadata(commentBody: string, metadata: FindingMetadata): string {
    const tag = `<!-- ai-review-finding:${JSON.stringify(metadata)} -->`;
    if (/<!-- ai-review-finding:[\s\S]*?-->/.test(commentBody)) {
      return commentBody.replace(/<!-- ai-review-finding:[\s\S]*?-->/, tag);
    }
    return `${commentBody}\n${tag}`;
  }

  async listPullRequestReviews(options: ListReviewsOptions): Promise<ReadonlyArray<PrReview>> {
    const { owner, repo, pullNumber } = options;
    const response = await this.octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    return response.data.map((r) => ({
      id: r.id,
      state: r.state,
      user: r.user ? { login: r.user.login } : null,
    }));
  }

  async dismissReview(options: DismissReviewOptions): Promise<void> {
    const { owner, repo, pullNumber, reviewId, message } = options;
    try {
      await this.octokit.rest.pulls.dismissReview({
        owner,
        repo,
        pull_number: pullNumber,
        review_id: reviewId,
        message,
      });
    } catch (err) {
      const httpErr = err as { status?: number };
      if (httpErr.status === 422) return;
      throw err;
    }
  }

  async getCompareFiles(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<ChangedFile[]> {
    const response = await this.octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${head}`,
    });
    if (!response.data.files) return [];
    return response.data.files.map((f) => ({
      path: f.filename,
      status: normalizeStatus(f.status),
      patch: f.patch,
      additions: f.additions,
      deletions: f.deletions,
    }));
  }

  async findBotSummaryCommentId(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<number> {
    try {
      const { data } = await this.octokit.issues.listComments({
        owner,
        repo,
        issue_number: pullNumber,
        per_page: 100,
      });
      for (let i = data.length - 1; i >= 0; i--) {
        const comment = data[i];
        if (comment?.body?.includes('## 🤖 AI Code Review')) {
          return comment.id;
        }
      }
      return 0;
    } catch {
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Types for internal use
// ---------------------------------------------------------------------------

export interface PrReviewComment {
  id: number;
  nodeId: string;
  body: string;
  path: string;
  user: string;
  pullRequestReviewId: number | null;
}

export interface PrReview {
  id: number;
  state: string;
  user: { login: string } | null;
}

// ---------------------------------------------------------------------------
// Standalone helpers (kept for backward compat and module-level use)
// ---------------------------------------------------------------------------

/**
 * Reads the `before`/`after` SHAs from a GitHub Actions `synchronize` event.
 * Returns null for any other event type or when the payload is missing.
 */
export function getPushEventShasFromEnv(): PushEventShas | null {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(eventPath, 'utf-8'));
  } catch {
    return null;
  }

  if (typeof raw !== 'object' || raw === null) return null;
  const ev = raw as Record<string, unknown>;

  if (ev.action !== 'synchronize') return null;

  const before = typeof ev.before === 'string' ? ev.before : '';
  const after = typeof ev.after === 'string' ? ev.after : '';

  if (!before || !after) return null;

  return { before, after };
}

/**
 * Reads PR context from the environment variables injected by GitHub Actions.
 */
export function getPullRequestContextFromEnv(): PullRequestContext | null {
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!repository || !eventPath || !existsSync(eventPath)) {
    return null;
  }

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) return null;

  let event: unknown;
  try {
    event = JSON.parse(readFileSync(eventPath, 'utf-8'));
  } catch {
    return null;
  }

  if (typeof event !== 'object' || event === null) return null;
  const eventObj = event as Record<string, unknown>;

  const pr = eventObj.pull_request as Record<string, unknown> | undefined;
  if (!pr) return null;

  const head = pr.head as Record<string, unknown> | undefined;
  const base = pr.base as Record<string, unknown> | undefined;

  return {
    owner,
    repo,
    pullNumber: pr.number as number,
    headSha: (head?.sha as string) ?? '',
    baseSha: (base?.sha as string) ?? '',
    title: (pr.title as string) ?? '',
    body: (pr.body as string | null) ?? null,
  };
}

/**
 * Reads a pull_request_review_comment event from GITHUB_EVENT_PATH.
 */
export function getReviewCommentEventFromEnv(): {
  actor: string;
  commentId: number;
  commentBody: string;
  inReplyToId: number | null;
  pullNumber: number;
  owner: string;
  repo: string;
} | null {
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!repository || !eventPath || !existsSync(eventPath)) return null;

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(eventPath, 'utf-8'));
  } catch {
    return null;
  }

  if (typeof raw !== 'object' || raw === null) return null;
  const ev = raw as Record<string, unknown>;

  const comment = ev.comment as Record<string, unknown> | undefined;
  const pr = ev.pull_request as Record<string, unknown> | undefined;
  const sender = ev.sender as Record<string, unknown> | undefined;

  if (!comment || !pr) return null;

  return {
    actor: (sender?.login as string) ?? '',
    commentId: comment.id as number,
    commentBody: (comment.body as string) ?? '',
    inReplyToId: (comment.in_reply_to_id as number | null) ?? null,
    pullNumber: pr.number as number,
    owner,
    repo,
  };
}

/**
 * Parses a unified patch and returns, per file, the set of line numbers on
 * the new side (RIGHT) that were touched.
 */
export function buildDiffLineMap(files: ChangedFile[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();

  for (const file of files) {
    if (!file.patch) continue;
    const lines = new Set<number>();
    const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
    let currentNewLine = 0;

    for (const line of file.patch.split('\n')) {
      const match = hunkHeader.exec(line);
      if (match) {
        currentNewLine = parseInt(match[1], 10);
        continue;
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lines.add(currentNewLine);
        currentNewLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // deleted line — does not advance the new-side counter
      } else if (line.startsWith(' ')) {
        currentNewLine++;
      }
    }

    map.set(file.path, lines);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function normalizeStatus(status: string): ChangedFile['status'] {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

function severityEmoji(severity: ReviewFinding['severity']): string {
  switch (severity) {
    case 'critical':
      return '🔴';
    case 'major':
      return '🟠';
    case 'minor':
      return '🟡';
    case 'info':
      return '🔵';
    case 'nitpick':
      return '⚪';
  }
}

export function buildFindingMetadata(
  f: ReviewFinding,
  commentId: number,
  threadNodeId: string,
): FindingMetadata {
  const id = createHash('sha1')
    .update(`${f.file}:${f.line}:${f.title}`)
    .digest('hex')
    .slice(0, 12);

  return {
    id,
    file: f.file,
    line: f.line,
    severity: f.severity,
    status: 'open' as unknown as FindingStatus,
    dismissedBy: null,
    commentId,
    threadNodeId,
  };
}

function formatInlineCommentBody(f: ReviewFinding, metadata: FindingMetadata): string {
  const lines = [
    `${severityEmoji(f.severity)} **${f.severity.toUpperCase()}** · \`${f.category}\` · ${f.title}`,
    '',
    f.description,
  ];
  if (f.suggestion) {
    lines.push('', '**Sugerencia:**', '', f.suggestion);
  }
  lines.push(`\n<!-- ai-review-finding:${JSON.stringify(metadata)} -->`);
  return lines.join('\n');
}

function composeSummary(summary: string, orphans: ReviewFinding[]): string {
  const parts = ['## 🤖 AI Code Review', '', summary];

  if (orphans.length > 0) {
    parts.push(
      '',
      '### Observaciones adicionales',
      '',
      '_(Estos findings refieren a líneas fuera del diff de este PR o no pudieron mapearse a inline comments.)_',
      '',
    );
    for (const f of orphans) {
      parts.push(
        `- ${severityEmoji(f.severity)} **${f.severity.toUpperCase()}** \`${f.file}:${f.line}\` · ${f.category}: **${f.title}** — ${f.description}`,
      );
    }
  }

  parts.push(
    '',
    '---',
    '_Generado por [ai-code-reviewer](https://www.npmjs.com/package/ai-code-reviewer)._',
  );
  return parts.join('\n');
}
