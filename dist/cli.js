#!/usr/bin/env node
import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewPullRequest, reviewSingleFile, reviewLocalDiff } from './reviewer.js';
// Cargar .env si existe en cwd (para uso local; en Actions las env vars vienen del workflow)
loadEnv();
const __dirname = dirname(fileURLToPath(import.meta.url));
function readPackageVersion() {
    const candidates = [
        resolve(__dirname, '..', 'package.json'),
        resolve(__dirname, '..', '..', 'package.json'),
    ];
    for (const p of candidates) {
        if (existsSync(p)) {
            try {
                return JSON.parse(readFileSync(p, 'utf-8')).version ?? '0.0.0';
            }
            catch {
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
const commonOptions = (cmd) => cmd
    .option('-c, --config <path>', 'Path al archivo de configuración (default: .ai-review.yml en cwd)')
    .option('-r, --rules <path>', 'Path al archivo de reglas custom (markdown)')
    .option('-p, --provider <provider>', 'LLM provider: openai | anthropic | gemini | ollama')
    .option('-m, --model <model>', 'Modelo del LLM a usar (override del config)')
    .option('-l, --language <lang>', 'Idioma del review: es | en')
    .option('-t, --tech <tech>', 'Forzar tech stack (override de auto-detección)')
    .option('-s, --save <path>', 'Guardar el report en markdown al path especificado');
commonOptions(program
    .command('review-pr')
    .description('Revisa el PR actual (pensado para correr en GitHub Actions sobre evento pull_request) y postea el review')
    .option('--dry-run', 'No postear review al PR — solo imprimir el resultado')).action(async (opts) => {
    try {
        await reviewPullRequest(opts);
    }
    catch (err) {
        handleError(err);
    }
});
commonOptions(program
    .command('review-file <file>')
    .description('Revisa un archivo local específico (útil para iterar reglas localmente)')).action(async (file, opts) => {
    try {
        await reviewSingleFile(file, opts);
    }
    catch (err) {
        handleError(err);
    }
});
commonOptions(program
    .command('review-diff')
    .description('Revisa el diff local (git diff) - útil pre-commit')
    .option('--staged', 'Revisar solo los cambios staged (git diff --cached)')
    .option('--base <ref>', 'Comparar contra esta ref en vez de HEAD (ej: main)')).action(async (opts) => {
    try {
        await reviewLocalDiff(opts);
    }
    catch (err) {
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
    console.log(chalk.dim(`\nEditá el archivo según tu proyecto. Para reglas custom más extensas, creá también un code-review-rules.md y referencialo desde el config.`));
});
function handleError(err) {
    if (err instanceof Error) {
        console.error(chalk.red(`\n✗ Error: ${err.message}`));
        if (process.env.DEBUG)
            console.error(err.stack);
    }
    else {
        console.error(chalk.red(`\n✗ Error desconocido: ${String(err)}`));
    }
    process.exit(1);
}
const EXAMPLE_CONFIG = `# Configuración de ai-code-reviewer
# Docs: https://github.com/giolabs/ai-code-reviewer

# LLM Provider. Opciones: openai | anthropic | gemini | ollama
# La API key se lee de variables de entorno (GitHub Secrets en CI):
#   - openai:    OPENAI_API_KEY
#   - anthropic: ANTHROPIC_API_KEY
#   - gemini:    GEMINI_API_KEY
#   - ollama:    no requiere API key
provider: openai

# Modelo del provider. Si se omite, se usa el default del provider.
# Ejemplos por provider:
#   - openai:    gpt-4o-mini (default), gpt-4o
#   - anthropic: claude-sonnet-4-20250514 (default), claude-opus-4-20250514
#   - gemini:    gemini-1.5-flash (default), gemini-1.5-pro
#   - ollama:    requiere especificar (ej: codellama, deepseek-coder)
model: gpt-4o-mini

# Idioma de los reviews: es | en
language: es

# Tech stack. Si se omite, se auto-detecta desde package.json.
# Opciones: nestjs | react | nextjs | typescript | node | flutter | laravel | generic
# tech: nestjs

# Path opcional a archivo markdown con reglas custom del proyecto.
# Estas reglas se concatenan al system prompt y tienen prioridad sobre las built-in.
# rules: ./code-review-rules.md

# Patrones de archivos a ignorar (glob simple)
ignore:
  - node_modules/**
  - dist/**
  - build/**
  - "*.lock"
  - package-lock.json
  - yarn.lock
  - "*.min.js"
  - coverage/**

# Severidad mínima a reportar: critical | major | minor | info | nitpick
minSeverity: minor

# Tamaño máximo de patch por archivo, en bytes. Archivos con diffs gigantes
# se ignoran (suelen ser autogenerados).
maxFileSize: 100000

# Categorías de checks. Apagá las que no quieras.
checks:
  security: true
  performance: true
  maintainability: true
  testing: true
  documentation: false
  style: false
  bug-risk: true
  architecture: true

# Postear comentarios inline en las líneas afectadas del PR
inlineComments: true

# Postear un comentario summary general en el PR
summaryComment: true

# Cantidad máxima de inline comments. Findings extras se mergean al summary.
maxInlineComments: 20

# Instrucciones adicionales que se agregan al system prompt.
# customInstructions: |
#   Este proyecto sigue Clean Architecture estricta. Cualquier import desde una
#   capa de dominio hacia infraestructura es un finding 'major'.
`;
program.parseAsync(process.argv).catch(handleError);
