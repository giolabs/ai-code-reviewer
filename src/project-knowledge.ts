import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { ConfigLoader } from './config.js';
import type { ProjectContextConfig } from './types.js';

interface ProjectKnowledgeDigestDeps {
  cwd: string;
}

interface BuildDigestArgs {
  config: ProjectContextConfig;
  /** Changed file paths (repo-relative) — used to rank ADRs/docs before truncation. */
  changedPaths?: ReadonlyArray<string>;
  prTitle?: string;
  prBody?: string | null;
}

interface RankedDoc {
  path: string;
  score: number;
}

export interface ProjectKnowledgeResult {
  /** Assembled, char-bounded digest, or empty string when nothing was found. */
  digest: string;
  /** Stable hash of the source files, used to invalidate the cached digest. */
  hash: string;
}

/**
 * Reads project-authority documents (CLAUDE.md + selected docs/) and assembles
 * a bounded knowledge digest injected into the review prompt (Axis 7).
 * When PR/diff hints are provided, ranks docs by relevance before truncation.
 */
export class ProjectKnowledgeDigest {
  private static readonly MAX_WALK_FILES = 400;

  constructor(private readonly deps: ProjectKnowledgeDigestDeps) {}

  build(args: BuildDigestArgs): ProjectKnowledgeResult {
    const { config } = args;
    const files = this.collectRelevantFiles({
      config,
      changedPaths: args.changedPaths ?? [],
      prTitle: args.prTitle,
      prBody: args.prBody,
    });

    if (files.length === 0) {
      return { digest: '', hash: '' };
    }

    const sections: string[] = [];
    const hasher = createHash('sha1');
    let used = 0;

    for (const relPath of files) {
      const absPath = resolve(this.deps.cwd, relPath);
      const content = this.readSafe(absPath);
      if (content === null) continue;

      hasher.update(`${relPath}:${content.length}\n`);

      const remaining = config.maxChars - used;
      if (remaining <= 0) continue;

      const slice = content.slice(0, remaining);
      const section = `### ${relPath}\n${slice}`;
      sections.push(section);
      used += section.length;
    }

    return {
      digest: sections.join('\n\n'),
      hash: hasher.digest('hex').slice(0, 16),
    };
  }

  private collectRelevantFiles(args: {
    config: ProjectContextConfig;
    changedPaths: ReadonlyArray<string>;
    prTitle?: string;
    prBody?: string | null;
  }): ReadonlyArray<string> {
    const { config, changedPaths, prTitle, prBody } = args;
    const claudeFirst: string[] = [];
    const docs: string[] = [];

    if (config.claudeMd && existsSync(resolve(this.deps.cwd, 'CLAUDE.md'))) {
      claudeFirst.push('CLAUDE.md');
    }

    const candidates = this.walkMarkdown(this.deps.cwd);
    for (const relPath of candidates) {
      if (relPath === 'CLAUDE.md') continue;
      if (config.docsGlobs.some((glob) => ConfigLoader.matchesPattern(relPath, glob))) {
        docs.push(relPath);
      }
    }

    const keywords = this.extractKeywords({ prTitle, prBody, changedPaths });
    const ranked: RankedDoc[] = docs.map((path) => ({
      path,
      score: this.scoreDoc({ path, changedPaths, keywords }),
    }));
    ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    return [...claudeFirst, ...ranked.map((r) => r.path)];
  }

  private extractKeywords(args: {
    prTitle?: string;
    prBody?: string | null;
    changedPaths: ReadonlyArray<string>;
  }): ReadonlyArray<string> {
    const blob = [args.prTitle ?? '', args.prBody ?? '', ...args.changedPaths].join(' ');
    const tokens = new Set<string>();

    for (const match of blob.matchAll(/\b(?:ADR|US)[-_]?\d+\b/gi)) {
      tokens.add(match[0].toLowerCase());
    }

    for (const match of blob.matchAll(/[a-zA-Z][a-zA-Z0-9_-]{3,}/g)) {
      tokens.add(match[0].toLowerCase());
    }

    return [...tokens];
  }

  private scoreDoc(args: {
    path: string;
    changedPaths: ReadonlyArray<string>;
    keywords: ReadonlyArray<string>;
  }): number {
    const { path, changedPaths, keywords } = args;
    const lowerPath = path.toLowerCase();
    let score = 0;

    if (lowerPath.includes('/adr/') || lowerPath.includes('adr-')) {
      score += 20;
    }

    for (const changed of changedPaths) {
      const segments = changed.toLowerCase().split('/').filter(Boolean);
      for (const seg of segments) {
        if (seg.length >= 3 && lowerPath.includes(seg)) {
          score += 5;
        }
      }
    }

    for (const keyword of keywords) {
      if (lowerPath.includes(keyword)) {
        score += keyword.startsWith('adr') || keyword.startsWith('us') ? 30 : 3;
      }
    }

    return score;
  }

  private walkMarkdown(root: string): ReadonlyArray<string> {
    const found: string[] = [];
    const stack: string[] = [resolve(root, 'docs')];

    while (stack.length > 0 && found.length < ProjectKnowledgeDigest.MAX_WALK_FILES) {
      const dir = stack.pop();
      if (!dir || !existsSync(dir)) continue;

      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const abs = join(dir, entry);
        let isDir = false;
        try {
          isDir = statSync(abs).isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          stack.push(abs);
        } else if (entry.endsWith('.md')) {
          found.push(relative(root, abs));
        }
      }
    }

    return found;
  }

  private readSafe(absPath: string): string | null {
    try {
      return readFileSync(absPath, 'utf-8');
    } catch {
      return null;
    }
  }
}
