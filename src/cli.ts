#!/usr/bin/env node
import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewPullRequest, reviewSingleFile, reviewLocalDiff } from './reviewer.js';
import { handleFeedback } from './handle-feedback.js';

// Load .env if present in cwd (for local use; in Actions env vars come from the workflow)
loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  const candidates = [
    resolve(__dirname, '..', 'package.json'),
    resolve(__dirname, '..', '..', 'package.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8')).version ?? '0.0.0';
      } catch {
        /* noop */
      }
    }
  }
  return '0.0.0';
}

const program = new Command();

program
  .name('ai-code-reviewer')
  .description('AI-powered code review para PRs de GitHub, configurable por proyecto/tech stack.')
  .version(readPackageVersion());

const commonOptions = (cmd: Command) =>
  cmd
    .option('-c, --config <path>', 'Path al archivo de configuración (default: .ai-review.yml en cwd)')
    .option('-r, --rules <path>', 'Path al archivo de reglas custom (markdown)')
    .option('-p, --provider <provider>', 'LLM provider: openai | anthropic | gemini | ollama')
    .option('-m, --model <model>', 'Modelo del LLM a usar (override del config)')
    .option('-l, --language <lang>', 'Idioma del review: es | en')
    .option('-t, --tech <tech>', 'Forzar tech stack (override de auto-detección)')
    .option('-s, --save <path>', 'Guardar el report en markdown al path especificado');

commonOptions(
  program
    .command('review-pr')
    .description(
      'Revisa el PR actual (pensado para correr en GitHub Actions sobre evento pull_request) y postea el review',
    )
    .option('--dry-run', 'No postear review al PR — solo imprimir el resultado'),
).action(async (opts) => {
  try {
    await reviewPullRequest(opts);
  } catch (err) {
    handleError(err);
  }
});

commonOptions(
  program
    .command('review-file <file>')
    .description('Revisa un archivo local específico (útil para iterar reglas localmente)'),
).action(async (file: string, opts) => {
  try {
    await reviewSingleFile(file, opts);
  } catch (err) {
    handleError(err);
  }
});

commonOptions(
  program
    .command('review-diff')
    .description('Revisa el diff local (git diff) - útil pre-commit')
    .option('--staged', 'Revisar solo los cambios staged (git diff --cached)')
    .option('--base <ref>', 'Comparar contra esta ref en vez de HEAD (ej: main)'),
).action(async (opts) => {
  try {
    await reviewLocalDiff(opts);
  } catch (err) {
    handleError(err);
  }
});

program
  .command('handle-feedback')
  .description(
    'Procesa una respuesta a un inline comment del AI reviewer (slash commands /explain y /dismiss). Pensado para correr en GitHub Actions sobre evento pull_request_review_comment.',
  )
  .action(async () => {
    try {
      await handleFeedback();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('init')
  .description('Crea un archivo de configuración de ejemplo (.ai-review.yml) en cwd')
  .option('-f, --force', 'Sobrescribir si ya existe')
  .action((opts) => {
    const target = resolve(process.cwd(), '.ai-review.yml');
    if (existsSync(target) && !opts.force) {
      console.error(chalk.red(`✗ Ya existe ${target}. Usá --force para sobrescribir.`));
      process.exit(1);
    }
    writeFileSync(target, EXAMPLE_CONFIG, 'utf-8');
    console.log(chalk.green(`✓ Configuración creada en ${target}`));
    console.log(
      chalk.dim(
        `\nEditá el archivo según tu proyecto. Para reglas custom más extensas, creá también un code-review-rules.md y referencialo desde el config.`,
      ),
    );
  });

function handleError(err: unknown): never {
  if (err instanceof Error) {
    console.error(chalk.red(`\n✗ Error: ${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
  } else {
    console.error(chalk.red(`\n✗ Error desconocido: ${String(err)}`));
  }
  process.exit(1);
}

const EXAMPLE_CONFIG = `# ai-code-reviewer configuration
# Docs: https://github.com/giolabs/ai-code-reviewer

# LLM Provider. Options: openai | anthropic | gemini | ollama
# The API key is read from environment variables (GitHub Secrets in CI):
#   - openai:    OPENAI_API_KEY
#   - anthropic: ANTHROPIC_API_KEY
#   - gemini:    GEMINI_API_KEY
#   - ollama:    no API key required
provider: openai

# Provider model. If omitted, the provider's default is used.
# Examples per provider:
#   - openai:    gpt-4o-mini (default), gpt-4o
#   - anthropic: claude-sonnet-4-20250514 (default), claude-opus-4-20250514
#   - gemini:    gemini-1.5-flash (default), gemini-1.5-pro
#   - ollama:    must be specified (e.g. codellama, deepseek-coder)
model: gpt-4o-mini

# Review language: es | en
language: es

# Tech stack. If omitted, auto-detected from package.json.
# Options: nestjs | react | nextjs | typescript | node | flutter | laravel | generic
# tech: nestjs

# Optional path to a markdown file with custom project rules.
# These rules are appended to the system prompt and take priority over built-in rules.
# rules: ./code-review-rules.md

# File patterns to ignore (simple glob)
ignore:
  - node_modules/**
  - dist/**
  - build/**
  - "*.lock"
  - package-lock.json
  - yarn.lock
  - "*.min.js"
  - coverage/**

# Minimum severity to report: critical | major | minor | info | nitpick
minSeverity: minor

# Maximum patch size per file, in bytes. Files with very large diffs
# are ignored (they are usually auto-generated).
maxFileSize: 100000

# Check categories. Disable any you don't want.
checks:
  security: true
  performance: true
  maintainability: true
  testing: true
  documentation: false
  style: false
  bug-risk: true
  architecture: true

# Post inline comments on the affected lines of the PR
inlineComments: true

# Post a general summary comment on the PR
summaryComment: true

# Maximum number of inline comments. Extra findings are merged into the summary.
maxInlineComments: 20

# Additional instructions appended to the system prompt.
# customInstructions: |
#   This project follows strict Clean Architecture. Any import from a domain
#   layer into infrastructure is a 'major' finding.
`;

program.parseAsync(process.argv).catch(handleError);
