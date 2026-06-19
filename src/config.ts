import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { ReviewerConfig, CheckCategory } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Configuración por defecto. Cualquier campo no especificado por el usuario
 * cae acá.
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

const CONFIG_FILENAMES = [
  '.ai-review.yml',
  '.ai-review.yaml',
  '.ai-review.json',
  'ai-review.config.yml',
  'ai-review.config.yaml',
  'ai-review.config.json',
];

/**
 * Busca el archivo de configuración en cwd. Si se pasa un path explícito,
 * lo usa directamente.
 */
export function findConfigFile(explicitPath?: string, cwd = process.cwd()): string | null {
  if (explicitPath) {
    const resolved = resolve(cwd, explicitPath);
    if (!existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return resolved;
  }

  for (const filename of CONFIG_FILENAMES) {
    const candidate = resolve(cwd, filename);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Carga la configuración desde archivo + defaults. Si no hay archivo, retorna
 * defaults sin warning (es válido correr sin config).
 */
export function loadConfig(explicitPath?: string, cwd = process.cwd()): ReviewerConfig {
  const configPath = findConfigFile(explicitPath, cwd);
  if (!configPath) return { ...DEFAULT_CONFIG };

  const raw = readFileSync(configPath, 'utf-8');
  const parsed: Partial<ReviewerConfig> = configPath.endsWith('.json')
    ? JSON.parse(raw)
    : (yaml.load(raw) as Partial<ReviewerConfig>);

  // Merge profundo solo para `checks`; el resto reemplaza
  const checks: Record<CheckCategory, boolean> = {
    ...DEFAULT_CONFIG.checks,
    ...(parsed.checks ?? {}),
  };

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    checks,
    ignore: parsed.ignore ?? DEFAULT_CONFIG.ignore,
  };
}

/**
 * Lee el archivo de reglas custom (markdown). Si no existe, retorna null.
 */
export function loadRulesFile(rulesPath: string | undefined, cwd = process.cwd()): string | null {
  if (!rulesPath) return null;
  const resolved = resolve(cwd, rulesPath);
  if (!existsSync(resolved)) {
    throw new Error(`Rules file not found: ${resolved}`);
  }
  return readFileSync(resolved, 'utf-8');
}

/**
 * Carga un template built-in de reglas por tech stack desde `templates/`.
 */
export function loadBuiltinTemplate(tech: string): string | null {
  // Cuando corremos desde dist/, templates/ está en ../templates relativo al
  // archivo compilado. Cuando corremos con tsx, está dos niveles arriba.
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
 * Versión simple de glob matching. Soporta `**`, `*`, y nombres literales.
 * Suficiente para los patterns de ignore más comunes.
 *
 * Implementación: primero reemplazamos `**` con un placeholder único, después
 * `*` con `[^/]*`, y al final el placeholder por `.*`. Si hacemos `**` → `.*`
 * directamente, el `*` resultante es pisado por el reemplazo siguiente.
 */
export function matchesPattern(path: string, pattern: string): boolean {
  const DOUBLE_STAR = '\x00DOUBLESTAR\x00';
  const regex = pattern
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(new RegExp(DOUBLE_STAR, 'g'), '.*');
  return new RegExp(`^${regex}$`).test(path);
}

/**
 * Filtra una lista de paths según los patterns de ignore del config.
 */
export function filterIgnored(paths: string[], ignorePatterns: string[]): string[] {
  return paths.filter((path) => !ignorePatterns.some((p) => matchesPattern(path, p)));
}
