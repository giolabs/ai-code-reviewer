import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { ConfigLoader } from './config.js';
import { TechDetector } from './tech-detect.js';
import { PromptBuilder } from './prompts.js';
import { RulesLoader } from './rules.js';
import { OutputFormatter } from './output.js';
import { DependencyGraphIndexer } from './dependency-indexer.js';
import { createLLMAdapter } from './llm/factory.js';
import { ReviewJsonParser } from './llm/json-parser.js';
import {
  GitHubClient,
  buildDiffLineMap,
  getPullRequestContextFromEnv,
} from './github.js';
import type { PrReview } from './github.js';
import type { ChangedFile, ReviewerConfig, ReviewResult, TechStack, PullRequestContext } from './types.js';
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
  const configLoader = new ConfigLoader({ cwd });
  const config = configLoader.loadConfig(opts.configPath);

  if (opts.provider) config.provider = opts.provider as typeof config.provider;
  if (opts.model) config.model = opts.model;
  if (opts.language) config.language = opts.language;
  if (opts.minSeverity) config.minSeverity = opts.minSeverity as typeof config.minSeverity;

  const resolvedModel = config.providerModel ?? config.model;

  // appDir: subdirectory where package.json lives (monorepos with app not at root)
  const appCwd = config.appDir ? resolve(cwd, config.appDir) : cwd;

  const tech = (opts.tech ?? config.tech ?? new TechDetector({ cwd: appCwd }).detect()) as TechStack;

  const rulesLoader = new RulesLoader({ configLoader });
  const rulesPath = opts.rulesPath ?? config.rules;
  const projectRules = rulesLoader.loadProjectRules({ rulesPath, cwd });
  const globalRules = rulesLoader.loadGlobalRules(tech);
  const mergedRulesText = rulesLoader.mergeRules({
    project: projectRules,
    global: globalRules,
    enabledChecks: config.checks,
  });

  return { config, configLoader, mergedRulesText, tech, resolvedModel, cwd, appCwd };
}

function logHeader(tech: string, provider: string, model: string, language: string): void {
  console.log(chalk.dim(`Stack detectado: ${TechDetector.displayName(tech as TechStack)}`));
  console.log(chalk.dim(`Provider: ${provider} · Modelo: ${model} · Idioma: ${language}`));
  console.log();
}

export async function reviewPullRequest(opts: ReviewerCliOptions): Promise<ReviewPRResult | null> {
  const ctx = getPullRequestContextFromEnv();
  if (!ctx) {
    throw new Error(
      'No PR context detected. This command is intended to run in GitHub Actions on a pull_request event. For local use, run `review-file` or `review-diff`.',
    );
  }

  const { config, mergedRulesText, tech, resolvedModel, appCwd } = resolveConfig(opts);
  const formatter = new OutputFormatter();

  console.log(chalk.bold(`Revisando PR #${ctx.pullNumber}: ${ctx.title}`));
  logHeader(tech, config.provider, resolvedModel, config.language);

  const githubClient = new GitHubClient();
  const allFiles = await githubClient.getPullRequestFiles(ctx);

  const filteredPaths = ConfigLoader.filterIgnored(
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

  console.log(chalk.dim('Analizando grafo de dependencias...'));
  const indexer = new DependencyGraphIndexer({ cwd: appCwd, files: filtered, tech });
  const dependencyIndex = await indexer.build();
  if (!dependencyIndex) {
    console.log(chalk.dim('Grafo de dependencias: stack no soportado o madge falló, se omite.'));
  } else {
    const edgeCount =
      (dependencyIndex.match(/→/g) ?? []).length + (dependencyIndex.match(/←/g) ?? []).length;
    console.log(chalk.dim(`Grafo listo: ${filtered.length} archivos, ${edgeCount} relaciones.`));
    if (dependencyIndex.endsWith('...(truncated)')) {
      console.log(chalk.dim('Grafo truncado a 8.000 caracteres.'));
    }
  }

  const result = await callLLM({
    files: filtered,
    prTitle: ctx.title,
    prBody: ctx.body,
    config,
    mergedRulesText,
    tech,
    resolvedModel,
    dependencyIndex: dependencyIndex ?? undefined,
  });

  result.findings = formatter.filterBySeverity(result.findings, config.minSeverity);

  formatter.print(result);

  if (opts.save) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(process.cwd(), opts.save), formatter.toMarkdown(result), 'utf-8');
    console.log(chalk.dim(`\nReport guardado en ${opts.save}`));
  }

  if (opts.dryRun) {
    console.log(chalk.yellow('\n--dry-run activo: no se postea review al PR.'));
    return { recommendation: result.recommendation, findingsCount: result.findings.length };
  }

  const diffLineMap = buildDiffLineMap(filtered);

  let event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';
  if (shouldAutoApprove(result, config)) {
    console.log(
      chalk.green(
        `✓ Auto-aprobando PR #${ctx.pullNumber}: recomendación approve, sin findings bloqueantes.`,
      ),
    );
    await dismissBotReviews(githubClient, ctx);
    event = 'APPROVE';
  } else {
    if (config.autoApprove?.enabled) {
      console.log(
        chalk.yellow(
          `ℹ Auto-approve: condiciones no cumplidas (${buildSkipReason(result, config)}). Posteando como ${mapRecommendationToEvent(result.recommendation)}.`,
        ),
      );
    }
    event = mapRecommendationToEvent(result.recommendation);
  }

  await githubClient.postReview(ctx, {
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

export function shouldAutoApprove(result: ReviewResult, config: ReviewerConfig): boolean {
  const cfg = config.autoApprove;
  if (!cfg?.enabled) return false;
  if (result.recommendation !== 'approve') return false;
  const hasBlocking = result.findings.some(
    (f) => f.severity === 'critical' || f.severity === 'major',
  );
  if (hasBlocking) return false;
  if (typeof result.overallScore === 'number' && result.overallScore < cfg.minScore) return false;
  return true;
}

function buildSkipReason(result: ReviewResult, config: ReviewerConfig): string {
  if (result.recommendation !== 'approve') return `recommendation=${result.recommendation}`;
  const hasBlocking = result.findings.some(
    (f) => f.severity === 'critical' || f.severity === 'major',
  );
  if (hasBlocking) return 'hay findings críticos o mayores';
  const minScore = config.autoApprove?.minScore ?? 7;
  if (typeof result.overallScore === 'number' && result.overallScore < minScore) {
    return `score ${result.overallScore} < minScore ${minScore}`;
  }
  return 'desconocido';
}

async function dismissBotReviews(
  githubClient: GitHubClient,
  ctx: PullRequestContext,
): Promise<void> {
  let reviews: ReadonlyArray<PrReview>;
  try {
    reviews = await githubClient.listPullRequestReviews({
      owner: ctx.owner,
      repo: ctx.repo,
      pullNumber: ctx.pullNumber,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`  ⚠ No se pudieron obtener los reviews previos: ${msg}`));
    return;
  }

  const botReviews = reviews.filter(
    (r) => r.state === 'CHANGES_REQUESTED' && r.user?.login === 'github-actions[bot]',
  );

  for (const review of botReviews) {
    console.log(chalk.dim(`  Descartando review #${review.id} del bot...`));
    try {
      await githubClient.dismissReview({
        owner: ctx.owner,
        repo: ctx.repo,
        pullNumber: ctx.pullNumber,
        reviewId: review.id,
        message: 'Findings corregidos — review descartado automáticamente.',
      });
      console.log(chalk.dim(`  ✓ Review #${review.id} descartado.`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`  ⚠ No se pudo descartar review #${review.id}: ${msg}`));
    }
  }
}

function extractSummaryForPost(result: ReviewResult): string {
  const parts = [result.summary];
  if (typeof result.overallScore === 'number') {
    parts.push('', `**Score:** ${result.overallScore}/10`);
  }
  parts.push(`**Recomendación del modelo:** \`${result.recommendation}\``);

  const anticipatedBugs = result.anticipatedBugs ?? [];
  if (anticipatedBugs.length > 0) {
    parts.push('', '## 🐛 Bugs Anticipados', '');
    for (const bug of anticipatedBugs) {
      parts.push(`- **[${bug.severity.toUpperCase()}] ${bug.title}** (\`${bug.file}:${bug.line}\`): ${bug.description}`);
    }
  }

  const regressionRisks = result.regressionRisks ?? [];
  if (regressionRisks.length > 0) {
    parts.push('', '## ⚠️ Riesgos de Regresión', '');
    for (const r of regressionRisks) {
      parts.push(`- **\`${r.symbol}\`** en \`${r.file}\`: ${r.reason}`);
    }
  }

  return parts.join('\n');
}

export async function reviewSingleFile(filePath: string, opts: ReviewerCliOptions): Promise<void> {
  const { config, mergedRulesText, tech, resolvedModel } = resolveConfig(opts);
  const formatter = new OutputFormatter();

  const absPath = resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
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

  result.findings = formatter.filterBySeverity(result.findings, config.minSeverity);
  formatter.print(result);

  if (opts.save) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(process.cwd(), opts.save), formatter.toMarkdown(result), 'utf-8');
    console.log(chalk.dim(`\nReport guardado en ${opts.save}`));
  }
}

export async function reviewLocalDiff(
  opts: ReviewerCliOptions & { staged?: boolean; base?: string },
): Promise<void> {
  const { config, mergedRulesText, tech, resolvedModel } = resolveConfig(opts);
  const formatter = new OutputFormatter();

  const diffArgs = opts.staged
    ? ['--cached']
    : opts.base
      ? [`${opts.base}...HEAD`]
      : ['HEAD'];

  console.log(chalk.bold(`Revisando diff local: git diff ${diffArgs.join(' ')}`));
  logHeader(tech, config.provider, resolvedModel, config.language);

  // Use execFileSync (not execSync) to avoid shell injection via user-provided refs
  const rawDiff = execFileSync('git', ['diff', '--no-color', ...diffArgs], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });

  const files = parseLocalDiff(rawDiff);

  const filteredPaths = ConfigLoader.filterIgnored(
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

  result.findings = formatter.filterBySeverity(result.findings, config.minSeverity);
  formatter.print(result);

  if (opts.save) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(process.cwd(), opts.save), formatter.toMarkdown(result), 'utf-8');
    console.log(chalk.dim(`\nReport guardado en ${opts.save}`));
  }
}

async function callLLM(args: {
  files: ChangedFile[];
  prTitle?: string;
  prBody?: string | null;
  config: ReviewerConfig;
  mergedRulesText: string;
  tech: TechStack;
  resolvedModel: string;
  dependencyIndex?: string;
}): Promise<ReviewResult> {
  const { files, prTitle, prBody, config, mergedRulesText, tech, resolvedModel, dependencyIndex } = args;

  const promptBuilder = new PromptBuilder();
  const systemPrompt = promptBuilder.buildSystemPrompt({ config, tech, mergedRulesText, dependencyIndex });
  const userPrompt = promptBuilder.buildUserPrompt({ files, prTitle, prBody });

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

  const parser = new ReviewJsonParser();
  const parsed = parser.parse(response.content);

  return { ...parsed, tokensUsed: response.tokensUsed };
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
