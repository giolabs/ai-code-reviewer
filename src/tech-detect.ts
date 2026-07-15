import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TechStack } from './types.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface TechDetectorOptions {
  cwd?: string;
}

/**
 * Detects the project tech stack by reading `package.json` and characteristic
 * root files. Order matters: more specific stacks first
 * (Next.js before React, NestJS before Node).
 */
export class TechDetector {
  private readonly cwd: string;

  constructor(options: TechDetectorOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
  }

  detect(): TechStack {
    // Detect non-JS stacks first via marker files
    if (existsSync(resolve(this.cwd, 'pubspec.yaml'))) return 'flutter';
    if (existsSync(resolve(this.cwd, 'composer.json'))) return 'laravel';

    const pkgPath = resolve(this.cwd, 'package.json');
    if (!existsSync(pkgPath)) return 'generic';

    let pkg: PackageJson;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
    } catch {
      return 'generic';
    }

    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if (allDeps['next']) return 'nextjs';
    if (allDeps['@nestjs/core']) return 'nestjs';
    if (allDeps['react']) return 'react';
    if (allDeps['typescript']) return 'typescript';

    return 'node';
  }

  /**
   * Detects the tech stack independently for each of the given directories
   * (relative to this detector's cwd). `detect()` itself is not reused
   * directly since it reads `this.cwd`, fixed at construction — each
   * directory gets its own short-lived TechDetector instance instead.
   */
  detectAll(dirs: ReadonlyArray<string>): ReadonlyArray<{ dir: string; tech: TechStack }> {
    return dirs.map((dir) => ({
      dir,
      tech: new TechDetector({ cwd: resolve(this.cwd, dir) }).detect(),
    }));
  }

  /**
   * Reads the installed major version of the primary framework for the given
   * stack from `package.json`. Returns null for non-JS stacks or when absent.
   * Deterministic and offline (Axis 8A).
   */
  detectStackVersion(tech: TechStack): string | null {
    const primaryDep: Partial<Record<TechStack, string>> = {
      nextjs: 'next',
      nestjs: '@nestjs/core',
      react: 'react',
      typescript: 'typescript',
    };
    const dep = primaryDep[tech];
    if (!dep) return null;

    const pkgPath = resolve(this.cwd, 'package.json');
    if (!existsSync(pkgPath)) return null;

    let pkg: PackageJson;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
    } catch {
      return null;
    }

    const range = pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep];
    if (!range) return null;

    const major = /(\d+)/.exec(range);
    return major ? major[1] : null;
  }

  static displayName(tech: TechStack): string {
    const map: Record<TechStack, string> = {
      nestjs: 'NestJS',
      react: 'React',
      nextjs: 'Next.js',
      typescript: 'TypeScript',
      node: 'Node.js',
      flutter: 'Flutter',
      laravel: 'Laravel',
      generic: 'Generic',
    };
    return map[tech];
  }
}
