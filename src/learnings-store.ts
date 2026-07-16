import type { GitHubClient } from './github.js';

const FILE_PATH = '.ai-review-learnings.md';
const HEADER =
  '# AI Reviewer Learnings\n\n_Auto-maintained by ai-code-reviewer. Edit or delete lines directly to remove a learning._\n';

interface LearningsRepoArgs {
  githubClient: GitHubClient;
  owner: string;
  repo: string;
  baseRefName: string;
}

interface AppendArgs extends LearningsRepoArgs {
  entry: string;
  maxChars: number;
}

interface FormatEntryArgs {
  text: string;
  actor: string;
  pullNumber: number;
  date: string;
}

/**
 * Owns the on-disk format of `.ai-review-learnings.md` and its read/write
 * calls against the GitHub Contents API. Committed directly to the PR's base
 * branch so a rule learned in one PR applies to every future PR against that
 * same branch — unlike `suppressedFingerprints`, which stays scoped to one PR.
 */
export class LearningsStore {
  /** One-line bullet in the format every entry uses. */
  static formatEntry(args: FormatEntryArgs): string {
    return `- ${args.text} (agregado por @${args.actor}, PR #${args.pullNumber}, ${args.date})`;
  }

  /** Full text of the learnings file for `baseRefName`, or `''` when it doesn't exist yet. */
  async read(args: LearningsRepoArgs): Promise<string> {
    const content = await args.githubClient.getFileAtRef({
      owner: args.owner,
      repo: args.repo,
      path: FILE_PATH,
      ref: args.baseRefName,
    });
    return content ?? '';
  }

  /** Appends one bullet, truncating the oldest entries first past `maxChars`. Returns false if the commit ultimately failed. */
  async append(args: AppendArgs): Promise<boolean> {
    return this.appendWithRetry({ ...args, attempt: 0 });
  }

  private async appendWithRetry(args: AppendArgs & { attempt: number }): Promise<boolean> {
    const existing = await args.githubClient.getFileWithSha({
      owner: args.owner,
      repo: args.repo,
      path: FILE_PATH,
      ref: args.baseRefName,
    });

    const nextContent = this.buildNextContent({
      current: existing?.content ?? '',
      entry: args.entry,
      maxChars: args.maxChars,
    });

    try {
      await args.githubClient.createOrUpdateFile({
        owner: args.owner,
        repo: args.repo,
        path: FILE_PATH,
        branch: args.baseRefName,
        message: 'chore(ai-review): update learnings',
        content: nextContent,
        ...(existing ? { sha: existing.sha } : {}),
      });
      return true;
    } catch (err) {
      if (this.isConflict(err) && args.attempt === 0) {
        return this.appendWithRetry({ ...args, attempt: 1 });
      }
      return false;
    }
  }

  private isConflict(err: unknown): boolean {
    if (typeof err !== 'object' || err === null || !('status' in err)) return false;
    return (err as { status: unknown }).status === 409;
  }

  private buildNextContent(args: { current: string; entry: string; maxChars: number }): string {
    const bullets = this.parseBullets(args.current);
    bullets.push(args.entry);
    return this.render({ bullets, maxChars: args.maxChars });
  }

  private parseBullets(content: string): string[] {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '));
  }

  /** FIFO truncation: drop the oldest bullet first, but never below one entry. */
  private render(args: { bullets: string[]; maxChars: number }): string {
    const bullets = [...args.bullets];
    let body = [HEADER, ...bullets].join('\n');
    while (body.length > args.maxChars && bullets.length > 1) {
      bullets.shift();
      body = [HEADER, ...bullets].join('\n');
    }
    return body;
  }
}
