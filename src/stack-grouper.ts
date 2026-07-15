import { resolve } from 'node:path';
import chalk from 'chalk';
import { TechDetector } from './tech-detect.js';
import type { ChangedFile, StackGroup, TechStack } from './types.js';

/** Result of running TechDetector against the repo root and every configured appDir directory. */
export interface StackDetection {
  /** Tech per configured appDir directory (does not include the root/fallback entry) */
  dirs: ReadonlyArray<{ dir: string; tech: TechStack }>;
  /** Tech detected at the repo root, used for files outside every configured directory */
  rootTech: TechStack;
}

interface DetectArgs {
  appDir: string | ReadonlyArray<string> | undefined;
  cwd: string;
}

interface GroupArgs {
  cwd: string;
  files: ReadonlyArray<ChangedFile>;
  maxStackGroups: number;
  detection: StackDetection;
}

interface MutableGroup {
  dir: string;
  tech: TechStack;
  files: ChangedFile[];
}

/**
 * Splits a PR's changed files into stack groups by directory, so each group
 * can be reviewed with its own tech-specific rules. Files outside every
 * configured `appDir` directory fall back to the stack detected at the repo
 * root. Detection (filesystem-only) and grouping (pure bucketing) are split
 * so a cached `StackDetection` can be reused across pushes without
 * re-running `TechDetector`.
 */
export class StackGrouper {
  /** Normalizes `appDir` (undefined, a single string, or an array) into a plain string array. */
  static normalizeAppDirs(appDir: string | ReadonlyArray<string> | undefined): string[] {
    if (appDir === undefined) return [];
    if (typeof appDir === 'string') return [appDir];
    return [...appDir];
  }

  detect(args: DetectArgs): StackDetection {
    const dirs = StackGrouper.normalizeAppDirs(args.appDir);
    const detector = new TechDetector({ cwd: args.cwd });
    return {
      dirs: detector.detectAll(dirs),
      rootTech: detector.detect(),
    };
  }

  group(args: GroupArgs): StackGroup[] {
    const { cwd, files, maxStackGroups, detection } = args;
    const dirs = detection.dirs.map((d) => d.dir);

    const buckets = new Map<string, ChangedFile[]>();
    for (const dir of dirs) buckets.set(dir, []);
    const fallbackFiles: ChangedFile[] = [];

    for (const file of files) {
      const dir = this.pickDir(file.path, dirs);
      if (dir === null) {
        fallbackFiles.push(file);
      } else {
        buckets.get(dir)!.push(file);
      }
    }

    let groups: MutableGroup[] = detection.dirs
      .map((d) => ({ dir: d.dir, tech: d.tech, files: buckets.get(d.dir)! }))
      .filter((g) => g.files.length > 0);

    if (groups.length > maxStackGroups) {
      groups = [...groups].sort((a, b) => b.files.length - a.files.length);
      const degraded = groups.slice(maxStackGroups);
      groups = groups.slice(0, maxStackGroups);
      for (const g of degraded) {
        console.log(
          chalk.yellow(
            `⚠ Stack "${g.dir}" (${TechDetector.displayName(g.tech)}) plegado al grupo de fallback: se superó maxStackGroups (${maxStackGroups}).`,
          ),
        );
        fallbackFiles.push(...g.files);
      }
    }

    const result: StackGroup[] = groups.map((g) => ({
      dir: g.dir,
      tech: g.tech,
      appCwd: resolve(cwd, g.dir),
      files: g.files,
    }));

    if (fallbackFiles.length > 0) {
      result.push({ dir: '.', tech: detection.rootTech, appCwd: cwd, files: fallbackFiles });
    }

    return result;
  }

  /**
   * Longest matching directory prefix, or null when no configured dir
   * matches (the fallback/root group). Public: also used by callers to
   * scope prior findings (from earlier pushes) to the same group a changed
   * file would be assigned to.
   */
  pickDir(filePath: string, dirs: ReadonlyArray<string>): string | null {
    let best: string | null = null;
    let bestLength = -1;
    for (const dir of dirs) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      if (filePath.startsWith(prefix) && prefix.length > bestLength) {
        best = dir;
        bestLength = prefix.length;
      }
    }
    return best;
  }
}
