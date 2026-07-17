import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

interface SiblingContextLoaderDeps {
  cwd: string;
}

interface LoadSiblingContextArgs {
  changedPaths: ReadonlyArray<string>;
  maxChars?: number;
  maxFiles?: number;
}

export interface SiblingContextResult {
  /** Markdown sections for the user prompt, or empty string when nothing found. */
  text: string;
  /** Number of sibling files included. */
  fileCount: number;
}

/**
 * Loads budgeted sibling test files and infra READMEs next to changed paths
 * so the first-pass model can verify "missing test/docs" claims before filing them.
 */
export class SiblingContextLoader {
  private static readonly DEFAULT_MAX_CHARS = 12_000;
  private static readonly DEFAULT_MAX_FILES = 15;

  private static readonly TEST_SUFFIXES: ReadonlyArray<string> = [
    '.spec.ts',
    '.spec.js',
    '.test.ts',
    '.test.js',
    '_test.dart',
  ];

  constructor(private readonly deps: SiblingContextLoaderDeps) {}

  load(args: LoadSiblingContextArgs): SiblingContextResult {
    const maxChars = args.maxChars ?? SiblingContextLoader.DEFAULT_MAX_CHARS;
    const maxFiles = args.maxFiles ?? SiblingContextLoader.DEFAULT_MAX_FILES;
    const candidates = this.collectCandidates(args.changedPaths);

    const sections: string[] = [];
    let used = 0;
    let fileCount = 0;

    for (const relPath of candidates) {
      if (fileCount >= maxFiles) break;
      const remaining = maxChars - used;
      if (remaining <= 0) break;

      const content = this.readSafe(resolve(this.deps.cwd, relPath));
      if (content === null) continue;

      const slice = content.slice(0, remaining);
      const section = `### ${relPath}\n\`\`\`\n${slice}\n\`\`\``;
      sections.push(section);
      used += section.length;
      fileCount += 1;
    }

    if (sections.length === 0) {
      return { text: '', fileCount: 0 };
    }

    const header = [
      '**Sibling context (tests / infra READMEs near changed files):**',
      'Before reporting a missing test, missing docs, or undocumented ops script, verify whether it is already covered below. If it is, do NOT file that finding.',
    ].join('\n');

    return {
      text: `${header}\n\n${sections.join('\n\n')}`,
      fileCount,
    };
  }

  private collectCandidates(changedPaths: ReadonlyArray<string>): ReadonlyArray<string> {
    const seen = new Set<string>();
    const result: string[] = [];

    const add = (relPath: string): void => {
      if (seen.has(relPath)) return;
      if (!existsSync(resolve(this.deps.cwd, relPath))) return;
      seen.add(relPath);
      result.push(relPath);
    };

    for (const changed of changedPaths) {
      for (const sibling of this.siblingTestPaths(changed)) {
        add(sibling);
      }
      const readme = this.infraReadmePath(changed);
      if (readme) add(readme);
    }

    return result;
  }

  private siblingTestPaths(changedPath: string): ReadonlyArray<string> {
    const dir = dirname(changedPath);
    const base = basename(changedPath);
    const stem = this.stripKnownExtension(base);
    if (!stem) return [];

    // If the changed file is already a test/spec, no sibling search needed for itself.
    if (this.isTestFile(base)) return [];

    return SiblingContextLoader.TEST_SUFFIXES.map((suffix) => join(dir, `${stem}${suffix}`));
  }

  private infraReadmePath(changedPath: string): string | null {
    const normalized = changedPath.replace(/\\/g, '/');
    if (!normalized.startsWith('infra/')) return null;

    const dir = dirname(changedPath);
    const sameDirReadme = join(dir, 'README.md');
    if (existsSync(resolve(this.deps.cwd, sameDirReadme))) return sameDirReadme;

    const parent = dirname(dir);
    if (parent !== '.' && parent.startsWith('infra')) {
      const parentReadme = join(parent, 'README.md');
      if (existsSync(resolve(this.deps.cwd, parentReadme))) return parentReadme;
    }

    return null;
  }

  private isTestFile(filename: string): boolean {
    return SiblingContextLoader.TEST_SUFFIXES.some((suffix) => filename.endsWith(suffix));
  }

  private stripKnownExtension(filename: string): string {
    const match = /^(.*)\.(ts|tsx|js|jsx|mjs|cjs|dart)$/.exec(filename);
    return match ? match[1] : '';
  }

  private readSafe(absPath: string): string | null {
    try {
      return readFileSync(absPath, 'utf-8');
    } catch {
      return null;
    }
  }
}
