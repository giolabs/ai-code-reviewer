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
 * The digest is authority ABOVE the generic stack rules — see spec §2.
 */
export class ProjectKnowledgeDigest {
  private static readonly MAX_WALK_FILES = 400;

  constructor(private readonly deps: ProjectKnowledgeDigestDeps) {}

  build(args: BuildDigestArgs): ProjectKnowledgeResult {
    const { config } = args;
    const files = this.collectRelevantFiles(config);

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

  private collectRelevantFiles(config: ProjectContextConfig): ReadonlyArray<string> {
    const result: string[] = [];

    if (config.claudeMd && existsSync(resolve(this.deps.cwd, 'CLAUDE.md'))) {
      result.push('CLAUDE.md');
    }

    const candidates = this.walkMarkdown(this.deps.cwd);
    for (const relPath of candidates) {
      if (relPath === 'CLAUDE.md') continue;
      if (config.docsGlobs.some((glob) => ConfigLoader.matchesPattern(relPath, glob))) {
        result.push(relPath);
      }
    }

    return result;
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
