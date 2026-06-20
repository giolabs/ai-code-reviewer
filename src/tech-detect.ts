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
