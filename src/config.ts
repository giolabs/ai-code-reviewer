import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { ReviewerConfig, CheckCategory, FeedbackConfig, AutoApproveConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Default configuration. Any field not specified by the user falls back to this.
 */
export const DEFAULT_CONFIG: ReviewerConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  language: 'es',
  ignore: [
    'node_modules/**',
    'dist/**',
    'build/**',
    '*.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '*.min.js',
    '*.min.css',
    '*.map',
    '*.svg',
    '*.png',
    '*.jpg',
    '*.jpeg',
    '*.gif',
    '*.ico',
    '*.pdf',
    'coverage/**',
    '.next/**',
    '.turbo/**',
  ],
  minSeverity: 'minor',
  maxFileSize: 100_000,
  checks: {
    security: true,
    performance: true,
    maintainability: true,
    testing: true,
    documentation: false,
    style: false,
    'bug-risk': true,
    architecture: true,
  },
  inlineComments: true,
  summaryComment: true,
  maxInlineComments: 20,
};

export const CONFIG_FILENAMES = [
  '.ai-review.yml',
  '.ai-review.yaml',
  '.ai-review.json',
  'ai-review.config.yml',
  'ai-review.config.yaml',
  'ai-review.config.json',
];

interface ConfigLoaderOptions {
  cwd?: string;
}

export class ConfigLoader {
  private readonly cwd: string;

  constructor(options: ConfigLoaderOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
  }

  findConfigFile(explicitPath?: string): string | null {
    if (explicitPath) {
      const resolved = resolve(this.cwd, explicitPath);
      if (!existsSync(resolved)) {
        throw new Error(`Config file not found: ${resolved}`);
      }
      return resolved;
    }

    for (const filename of CONFIG_FILENAMES) {
      const candidate = resolve(this.cwd, filename);
      if (existsSync(candidate)) return candidate;
    }

    return null;
  }

  loadConfig(explicitPath?: string): ReviewerConfig {
    const configPath = this.findConfigFile(explicitPath);
    if (!configPath) return { ...DEFAULT_CONFIG };

    const raw = readFileSync(configPath, 'utf-8');
    const parsed: Partial<ReviewerConfig> = configPath.endsWith('.json')
      ? (JSON.parse(raw) as Partial<ReviewerConfig>)
      : (yaml.load(raw) as Partial<ReviewerConfig>);

    // Deep merge only for `checks`; all other fields are replaced
    const checks: Record<CheckCategory, boolean> = {
      ...DEFAULT_CONFIG.checks,
      ...(parsed.checks ?? {}),
    };

    const feedback: FeedbackConfig | undefined = parsed.feedback
      ? {
          enabled: parsed.feedback.enabled ?? false,
          allowDismiss: parsed.feedback.allowDismiss ?? true,
        }
      : undefined;

    const autoApprove: AutoApproveConfig | undefined = parsed.autoApprove
      ? {
          enabled: parsed.autoApprove.enabled ?? false,
          minScore: parsed.autoApprove.minScore ?? 7,
        }
      : undefined;

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      checks,
      ignore: parsed.ignore ?? DEFAULT_CONFIG.ignore,
      ...(feedback !== undefined ? { feedback } : {}),
      ...(autoApprove !== undefined ? { autoApprove } : {}),
    };
  }

  loadRulesFile(rulesPath: string | undefined): string | null {
    if (!rulesPath) return null;
    const resolved = resolve(this.cwd, rulesPath);
    if (!existsSync(resolved)) {
      throw new Error(`Rules file not found: ${resolved}`);
    }
    return readFileSync(resolved, 'utf-8');
  }

  loadBuiltinTemplate(tech: string): string | null {
    // When running from dist/, templates/ is at ../templates relative to the compiled file.
    // When running with tsx, it is two levels up.
    const candidates = [
      resolve(__dirname, '..', 'templates', `${tech}-rules.md`),
      resolve(__dirname, '..', '..', 'templates', `${tech}-rules.md`),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return readFileSync(candidate, 'utf-8');
      }
    }

    return null;
  }

  /**
   * Simple glob matching. Supports `**`, `*`, and literal names.
   * Sufficient for the most common ignore patterns.
   */
  static matchesPattern(path: string, pattern: string): boolean {
    const DOUBLE_STAR = '\x00DOUBLESTAR\x00';
    const regex = pattern
      .replace(/\*\*/g, DOUBLE_STAR)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(new RegExp(DOUBLE_STAR, 'g'), '.*');
    return new RegExp(`^${regex}$`).test(path);
  }

  static filterIgnored(
    paths: ReadonlyArray<string>,
    ignorePatterns: ReadonlyArray<string>,
  ): string[] {
    return paths.filter(
      (path) => !ignorePatterns.some((p) => ConfigLoader.matchesPattern(path, p)),
    );
  }
}
