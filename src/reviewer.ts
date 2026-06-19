import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadConfig, filterIgnored } from './config.js';
import { detectTechStack, techDisplayName } from './tech-detect.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import { createLLMAdapter } from './llm/factory.js';
import { parseReviewJSON } from './llm/json-parser.js';
import { loadProjectRules, loadGlobalRules, mergeRules } from './rules.js';
import {
  buildDiffLineMap,
  createOctokit,
  getPullRequestContextFromEnv,
  getPullRequestFiles,
  postReview,
} from './github.js';
import { filterBySeverity, printReviewToTerminal, reviewToMarkdown } from './output.js';
import type { ChangedFile, ReviewResult, TechStack } from './types.js';
import type { LLMConfig } from './llm/types.js';

interface ReviewerCliOptions {
  configPath?: string;
  rulesPath?: string;
  model?: string;
  provider?: string;
  language?: 'es' | 'en';
  tech?: string;
  save?: string;
  dryRun?: boolean;
  minSeverity?: string;
}

export interface ReviewPRResult {
  recommendation: string;
  findingsCount: number;
}

function resolveConfig(opts: ReviewerCliOptions) {
  const cwd = process.cwd();
  const config = loadConfig(opts.configPath, cwd);

  if (opts.provider) config.provider = opts.provider as typeof config.provider;
  if (opts.model) config.model = opts.model;
  if (opts.language) config.language = opts.language;
  if (opts.minSeverity) config.minSeverity = opts.minSeverity as typeof config.minSeverity;

  const resolvedModel = config.providerModel ?? config.model;

  const tech = (opts.tech ?? config.tech ?? detectTechStack(cwd)) as TechStack;

  const rulesPath = opts.rulesPath ?? config.rules;
  const projectRules = loadProjectRules(rulesPath, cwd);
  const globalRules = loadGlobalRules(tech);
  const mergedRulesText = mergeRules(projectRules, globalRules, config.checks);

  return { config, mergedRulesText, tech, resolvedModel };
}

function logHeader(tech: string, provider: string, model: string, language: string) {
  console.log(chalk.dim(`Stack detectado: ${techDisplayName(tech as TechStack)}`));
  console.log(chalk.dim(`Provider: ${provider} · Modelo: ${model} · Idioma: ${language}`));
  console.log();
}

export async function reviewPullRequest(opts: ReviewerCliOptions): Promise<ReviewPRResult | null> {
  const ctx = getPullRequestContextFromEnv();
  if (!ctx) {
    throw new Error(
      'No se detectó contexto de PR. Este comando está pensado para correr en GitHub Actions sobre un evento pull_request. Para uso local, usá `review-file` o `review-diff`.',
    );
  }

  const { config, mergedRulesText, tech, resolvedModel } = resolveConfig(opts);

  console.log(chalk.bold(`Revisando PR #${ctx.pullNumber}: ${ctx.title}`));
  logHeader(tech, config.provider, resolvedModel, config.language);

  const octokit = createOctokit();
  const allFiles = await getPullRequestFiles(octokit, ctx);

  const filteredPaths = filterIgnored(
    allFiles.map((f) => f.path),
    config.ignore,
  );
  const filtered = allFiles
    .filter((f) => filteredPaths.includes(f.path))
    .filter((f) => f.status !== 'removed')
    .filter((f) => !f.patch || f.patch.length <= config.maxFileSize);

  if (filtered.length === 0) {
    console.log(chalk.yellow('No hay archivos para revisar después de aplicar filtros.'));
    return null;
  }

  console.log(chalk.dim(`Archivos a revisar: ${filtered.length} / ${allFiles.length}`));

  const result = await callLLM({
    files: filtered,
    prTitle: ctx.title,
    prBody: ctx.body,
    config,
    mergedRulesText,
    tech,
    resolvedModel,
  });

  result.findings = filterBySeverity(result.findings, config.minSeverity);

  printReviewToTerminal(result);

  if (opts.save) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(process.cwd(), opts.save), reviewToMarkdown(result), 'utf-8');
    console.log(chalk.dim(`\nReport guardado en ${opts.save}`));
  }

  if (opts.dryRun) {
    console.log(chalk.yellow('\n--dry-run activo: no se postea review al PR.'));
    return { recommendation: result.recommendation, findingsCount: result.findings.length };
  }

  const diffLineMap = buildDiffLineMap(filtered);
  const event = mapRecommendationToEvent(result.recommendation);

  await postReview(octokit, ctx, {
    summary: extractSummaryForPost(result),
    findings: result.findings,
    event,
    inlineComments: config.inlineComments,
    maxInlineComments: config.maxInlineComments,
    diffLineMap,
  });

  console.log(chalk.green(`\n✓ Review posteado en PR #${ctx.pullNumber}`));

  if (result.recommendation === 'request_changes') {
    process.exitCode = 1;
  }

  return { recommendation: result.recommendation, findingsCount: result.findings.length };
}

function mapRecommendationToEvent(
  rec: ReviewResult['recommendation'],
): 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' {
  if (rec === 'request_changes') return 'REQUEST_CHANGES';
  return 'COMMENT';
}

function extractSummaryForPost(result: ReviewResult): string {
  const parts = [result.summary];
  if (typeof result.overallScore === 'number') {
    parts.push('', `**Score:** ${result.overallScore}/10`);
  }
  parts.push(`**Recomendación del modelo:** \`${result.recommendation}\``);
  return parts.join('\n');
}

export async function reviewSingleFile(filePath: string, opts: ReviewerCliOptions): Promise<void> {
  const { config, mergedRulesText, tech, resolvedModel } = resolveConfig(opts);

  const absPath = resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) {
    throw new Error(`Archivo no encontrado: ${absPath}`);
  }
  const content = readFileSync(absPath, 'utf-8');

  console.log(chalk.bold(`Revisando archivo: ${filePath}`));
  logHeader(tech, config.provider, resolvedModel, config.language);

  const lines = content.split('\n');
  const patch = `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;

  const file: ChangedFile = {
    path: filePath,
    status: 'modified',
    patch,
    additions: lines.length,
    deletions: 0,
  };

  const result = await callLLM({
    files: [file],
    config,
    mergedRulesText,
    tech,
    resolvedModel,
  });

  result.findings = filterBySeverity(result.findings, config.minSeverity);
  printReviewToTerminal(result);

  if (opts.save) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(process.cwd(), opts.save), reviewToMarkdown(result), 'utf-8');
    console.log(chalk.dim(`\nReport guardado en ${opts.save}`));
  }
}

export async function reviewLocalDiff(
  opts: ReviewerCliOptions & { staged?: boolean; base?: string },
): Promise<void> {
  const { config, mergedRulesText, tech, resolvedModel } = resolveConfig(opts);

  const args = opts.staged
    ? ['--cached']
    : opts.base
      ? [`${opts.base}...HEAD`]
      : ['HEAD'];

  console.log(chalk.bold(`Revisando diff local: git diff ${args.join(' ')}`));
  logHeader(tech, config.provider, resolvedModel, config.language);

  const files = parseLocalDiff(
    execSync(`git diff --no-color ${args.join(' ')}`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }),
  );

  const filteredPaths = filterIgnored(
    files.map((f) => f.path),
    config.ignore,
  );
  const filtered = files.filter((f) => filteredPaths.includes(f.path));

  if (filtered.length === 0) {
    console.log(chalk.yellow('No hay cambios para revisar.'));
    return;
  }

  console.log(chalk.dim(`Archivos a revisar: ${filtered.length}`));

  const result = await callLLM({
    files: filtered,
    config,
    mergedRulesText,
    tech,
    resolvedModel,
  });

  result.findings = filterBySeverity(result.findings, config.minSeverity);
  printReviewToTerminal(result);

  if (opts.save) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(process.cwd(), opts.save), reviewToMarkdown(result), 'utf-8');
    console.log(chalk.dim(`\nReport guardado en ${opts.save}`));
  }
}

async function callLLM(args: {
  files: ChangedFile[];
  prTitle?: string;
  prBody?: string | null;
  config: ReturnType<typeof loadConfig>;
  mergedRulesText: string;
  tech: TechStack;
  resolvedModel: string;
}): Promise<ReviewResult> {
  const { files, prTitle, prBody, config, mergedRulesText, tech, resolvedModel } = args;

  const systemPrompt = buildSystemPrompt({ config, tech, mergedRulesText });
  const userPrompt = buildUserPrompt({ files, prTitle, prBody });

  const llmConfig: LLMConfig = {
    provider: config.provider,
    model: resolvedModel,
    ollamaUrl: config.ollamaUrl,
    temperature: 0.2,
  };

  const adapter = createLLMAdapter(llmConfig);

  const providerDisplay = config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
  console.log(chalk.dim(`Llamando a ${providerDisplay}...`));

  const response = await adapter.review({ systemPrompt, userPrompt });

  const parsed = config.provider === 'openai'
    ? JSON.parse(response.content)
    : parseReviewJSON(response.content);

  return {
    summary: parsed.summary,
    overallScore: parsed.overallScore,
    recommendation: parsed.recommendation,
    findings: Array.isArray(parsed.findings)
      ? parsed.findings.map((f: Record<string, unknown>) => ({
          file: f.file ?? '',
          line: f.line ?? 0,
          severity: f.severity ?? 'info',
          category: f.category ?? 'maintainability',
          title: f.title ?? '',
          description: f.description ?? '',
          suggestion: f.suggestion || undefined,
        }))
      : [],
    tokensUsed: response.tokensUsed,
  };
}

function parseLocalDiff(rawDiff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const fileHeaderRegex = /^diff --git a\/(.+?) b\/(.+?)$/;
  const lines = rawDiff.split('\n');

  let current: ChangedFile | null = null;
  let patchLines: string[] = [];

  const flush = () => {
    if (current) {
      current.patch = patchLines.join('\n');
      files.push(current);
    }
    patchLines = [];
  };

  for (const line of lines) {
    const headerMatch = fileHeaderRegex.exec(line);
    if (headerMatch) {
      flush();
      current = {
        path: headerMatch[2],
        status: 'modified',
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('new file mode')) current.status = 'added';
    if (line.startsWith('deleted file mode')) current.status = 'removed';

    if (line.startsWith('@@')) {
      patchLines.push(line);
    } else if (patchLines.length > 0) {
      patchLines.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) current.additions++;
      if (line.startsWith('-') && !line.startsWith('---')) current.deletions++;
    }
  }

  flush();
  return files;
}
