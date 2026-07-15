import { createHash } from 'node:crypto';
import type { GitHubClient } from './github.js';
import type { FindingMetadata, ResolveFixedOptions, ReviewFinding } from './types.js';
import { FindingStatus } from './types.js';

interface ThreadResolverOptions {
  githubClient: GitHubClient;
  botLogin?: string;
}

export class ThreadResolver {
  private readonly githubClient: GitHubClient;
  private readonly botLogin: string;

  constructor(options: ThreadResolverOptions) {
    this.githubClient = options.githubClient;
    this.botLogin = options.botLogin ?? 'github-actions[bot]';
  }

  async resolveFixed(options: ResolveFixedOptions): Promise<void> {
    const { pullNumber, owner, repo, newFindings, changedFiles, commitSha, summaryCommentId } =
      options;

    const allComments = await this.githubClient.getPullRequestReviewComments(
      owner,
      repo,
      pullNumber,
    );

    const changedFileSet = new Set(changedFiles);
    const newFindingIds = this.buildFindingIdSet(newFindings);

    let resolvedCount = 0;

    for (const comment of allComments) {
      if (comment.user !== this.botLogin) continue;

      const metadata = this.githubClient.extractFindingMetadata(comment.body);
      if (!metadata) continue;
      if (metadata.status !== FindingStatus.Open) continue;
      if (!changedFileSet.has(metadata.file)) continue;

      if (newFindingIds.has(metadata.id)) continue;

      await this.resolveThread({ owner, repo, comment, metadata, commitSha });
      resolvedCount++;
    }

    if (resolvedCount > 0) {
      await this.updateSummaryComment({ owner, repo, summaryCommentId, resolvedCount });
    }
  }

  private buildFindingIdSet(findings: ReadonlyArray<ReviewFinding>): Set<string> {
    const ids = new Set<string>();
    for (const f of findings) {
      const id = createHash('sha1')
        .update(`${f.file}:${f.line}:${f.title}`)
        .digest('hex')
        .slice(0, 12);
      ids.add(id);
    }
    return ids;
  }

  private async resolveThread(args: {
    owner: string;
    repo: string;
    comment: { id: number; body: string; nodeId: string };
    metadata: FindingMetadata;
    commitSha: string;
  }): Promise<void> {
    const { owner, repo, comment, metadata, commitSha } = args;
    const sha = commitSha.slice(0, 7);

    if (metadata.threadNodeId) {
      try {
        await this.githubClient.resolveThread({ threadNodeId: metadata.threadNodeId });
      } catch (err) {
        console.error(`Failed to resolve thread ${metadata.threadNodeId}:`, err);
      }
    }

    const updatedMetadata = { ...metadata, status: FindingStatus.Resolved };
    const updatedBody = this.githubClient.embedFindingMetadata(comment.body, updatedMetadata);

    try {
      await this.githubClient.editComment({
        owner,
        repo,
        commentId: comment.id,
        body: updatedBody,
        isPrReviewComment: true,
      });
    } catch (err) {
      console.error(`Failed to update metadata on comment ${comment.id}:`, err);
    }

    const replyBody =
      process.env.REVIEW_LANGUAGE === 'en'
        ? `Fixed in ${sha}. Thread auto-resolved.`
        : `Corregido en ${sha}. Hilo resuelto automáticamente.`;

    try {
      await this.githubClient.postReply({
        owner,
        repo,
        pullNumber: 0,
        commentId: comment.id,
        body: replyBody,
      });
    } catch (err) {
      console.error(`Failed to post resolution reply on comment ${comment.id}:`, err);
    }
  }

  private async updateSummaryComment(args: {
    owner: string;
    repo: string;
    summaryCommentId: number;
    resolvedCount: number;
  }): Promise<void> {
    if (args.summaryCommentId === 0) return;
    try {
      const existing = await this.githubClient.getIssueComment(
        args.owner,
        args.repo,
        args.summaryCommentId,
      );
      if (!existing) return;

      const line =
        process.env.REVIEW_LANGUAGE === 'en'
          ? `\n\n✅ ${args.resolvedCount} finding(s) auto-resolved by the latest push.`
          : `\n\n✅ ${args.resolvedCount} hallazgo(s) resuelto(s) automáticamente por el último push.`;

      await this.githubClient.editComment({
        owner: args.owner,
        repo: args.repo,
        commentId: args.summaryCommentId,
        body: existing.body + line,
        isPrReviewComment: false,
      });
    } catch (err) {
      console.error('Failed to update summary comment:', err);
    }
  }
}
