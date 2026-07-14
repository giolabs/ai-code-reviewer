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
import { ProjectKnowledgeDigest } from './project-knowledge.js';
import { FindingVerifier } from './finding-verifier.js';
import {
  GitHubClient,
  buildDiffLineMap,
  computeFindingFingerprint,
  getPullRequestContextFromEnv,
  getPushEventShasFromEnv,
} from './github.js';
import type { PrReview, PrReviewComment } from './github.js';
import { ThreadResolver } from './thread-resolver.js';
import { ProjectContextStore, REVIEWER_VERSION } from './project-context.js';
import type {
  ChangedFile,
  ReviewerConfig,
  ReviewResult,
  ReviewFinding,
  TechStack,
  PullRequestContext,
  PushEventShas,
  PriorFinding,
  ProjectContext,
} from './types.js';
import { FindingStatus } from './types.js';
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

  let projectDigest: string | undefined;
  if (config.projectContext) {
    const knowledge = new ProjectKnowledgeDigest({ cwd: appCwd });
    const built = knowledge.build({ config: config.projectContext });
    projectDigest = built.digest || undefined;
  }

  return { config, configLoader, mergedRulesText, tech, resolvedModel, cwd, appCwd, projectDigest };
}

function logHeader(tech: string, provider: string, model: string, language: string): void {
  console.log(chalk.dim(`Stack detectado: ${TechDetector.displayName(tech as TechStack)}`));
  console.log(chalk.dim(`Provider: ${provider} · Modelo: ${model} · Idioma: ${language}`));
  console.log();
}

function stripMetadataBlock(body: string): string {
  return body.replace(/\n?<!-- ai-review-finding:[\s\S]*?-->/, '').trim();
}

function collectPriorOpenFindings(
  comments: ReadonlyArray<PrReviewComment>,
  githubClient: GitHubClient,
): ReadonlyArray<PriorFinding> {
  const findings: PriorFinding[] = [];
  for (const comment of comments) {
    const metadata = githubClient.extractFindingMetadata(comment.body);
    if (!metadata || (metadata.status as string) !== FindingStatus.Open) continue;

    const stripped = stripMetadataBlock(comment.body);
    const firstLine = stripped.split('\n')[0] ?? '';
    const lastMarker = firstLine.lastIndexOf(' · ');
    const title = lastMarker >= 0 ? firstLine.slice(lastMarker + 3) : firstLine;
    const description = stripped.split('\n').slice(1).join('\n').trim();

    findings.push({
      file: metadata.file,
      line: metadata.line,
      severity: metadata.severity,
      title,
      description,
    });
  }
  return findings;
}

// Returns false when the caller should fall through to a full review (e.g. Compare API error).
// Returns ReviewPRResult when regressions were found and posted.
// Returns null when incremental review completed cleanly with no regressions to post.
async function runIncrementalReview(args: {
  ctx: PullRequestContext;
  config: ReviewerConfig;
  pushShas: PushEventShas;
  priorFindings: ReadonlyArray<PriorFinding>;
  githubClient: GitHubClient;
  mergedRulesText: string;
  tech: TechStack;
  resolvedModel: string;
  projectDigest?: string;
  opts: ReviewerCliOptions;
}): Promise<ReviewPRResult | null | false> {
  const { ctx, config, pushShas, priorFindings, githubClient, mergedRulesText, tech, resolvedModel, projectDigest, opts } = args;

  let incrementalFiles: ChangedFile[] = [];
  try {
    incrementalFiles = await githubClient.getCompareFiles(ctx.owner, ctx.repo, pushShas.before, pushShas.after);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`⚠ No se pudo obtener el compare diff: ${msg}. Cayendo a full review.`));
    return false;
  }

  const filteredPaths = ConfigLoader.filterIgnored(
    incrementalFiles.map((f) => f.path),
    config.ignore,
  );
  const filtered = incrementalFiles
    .filter((f) => filteredPaths.includes(f.path))
    .filter((f) => f.status !== 'removed')
    .filter((f) => !f.patch || f.patch.length <= config.maxFileSize);

  if (filtered.length === 0) {
    console.log(chalk.dim('Modo incremental: sin archivos nuevos en este push. Chequeando threads resueltos...'));
  } else {
    console.log(
      chalk.dim(
        `Modo incremental: ${filtered.length} archivo(s) nuevos en este push · ${priorFindings.length} finding(s) abiertos del review anterior`,
      ),
    );
  }

  const summaryCommentId = await githubClient.findBotSummaryCommentId(ctx.owner, ctx.repo, ctx.pullNumber);
  if (summaryCommentId === 0) {
    console.log(chalk.dim('Modo incremental: no se encontró el comment resumen del bot.'));
  }

  let result: ReviewResult | null = null;

  if (filtered.length > 0) {
    const promptBuilder = new PromptBuilder();
    const systemPrompt = promptBuilder.buildIncrementalSystemPrompt({ config, tech, mergedRulesText, projectDigest });
    const userPrompt = promptBuilder.buildIncrementalUserPrompt({
      files: filtered,
      priorFindings,
      prTitle: ctx.title,
    });

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
    result = { ...parsed, tokensUsed: response.tokensUsed };

    const formatter = new OutputFormatter();
    result.findings = formatter.filterBySeverity(result.findings, config.minSeverity);
    formatter.print(result);
  }

  const resolver = new ThreadResolver({ githubClient });
  await resolver.resolveFixed({
    pullNumber: ctx.pullNumber,
    owner: ctx.owner,
    repo: ctx.repo,
    newFindings: result?.findings ?? [],
    changedFiles: filtered.map((f) => f.path),
    commitSha: ctx.headSha,
    summaryCommentId,
  });

  if (result && result.findings.length > 0) {
    result.findings = await filterSuppressedFindings({
      githubClient,
      owner: ctx.owner,
      repo: ctx.repo,
      pullNumber: ctx.pullNumber,
      findings: result.findings,
    });
  }

  if (!result || result.findings.length === 0) {
    if (filtered.length > 0) {
      console.log(chalk.dim('Modo incremental: sin regresiones detectadas.'));
    }
    return null;
  }

  if (opts.dryRun) {
    console.log(chalk.yellow('\n--dry-run activo: no se postea review al PR.'));
    return { recommendation: result.recommendation, findingsCount: result.findings.length };
  }

  const diffLineMap = buildDiffLineMap(filtered);
  const event = mapRecommendationToEvent(result.recommendation);

  await githubClient.postReview(ctx, {
    summary: extractSummaryForPost(result),
    findings: result.findings,
    event,
    inlineComments: config.inlineComments,
    maxInlineComments: config.maxInlineComments,
    diffLineMap,
  });

  console.log(chalk.green(`\n✓ Review incremental posteado en PR #${ctx.pullNumber}`));

  if (result.recommendation === 'request_changes') {
    process.exitCode = 1;
  }

  return { recommendation: result.recommendation, findingsCount: result.findings.length };
}

export async function reviewPullRequest(opts: ReviewerCliOptions): Promise<ReviewPRResult | null> {
  const ctx = getPullRequestContextFromEnv();
  if (!ctx) {
    throw new Error(
      'No PR context detected. This command is intended to run in GitHub Actions on a pull_request event. For local use, run `review-file` or `review-diff`.',
    );
  }

  const { config, mergedRulesText, tech: detectedTech, resolvedModel, appCwd, projectDigest } = resolveConfig(opts);
  const formatter = new OutputFormatter();

  const pushShas = getPushEventShasFromEnv();
  const githubClient = new GitHubClient();

  // Project context graph: read cached tech stack from hidden PR comment.
  // Skip if config.tech is explicitly set (explicit config always wins).
  const contextStore = new ProjectContextStore();
  let foundContextBody: string | null = null;
  let tech: TechStack = detectedTech;

  if (!config.tech) {
    foundContextBody = await githubClient.findContextComment({
      owner: ctx.owner,
      repo: ctx.repo,
      pullNumber: ctx.pullNumber,
    });
    if (foundContextBody !== null) {
      const cachedContext = contextStore.deserialize(foundContextBody);
      if (cachedContext !== null && !contextStore.shouldInvalidate(cachedContext)) {
        tech = cachedContext.tech;
        console.log(chalk.dim(`✓ Tech stack leído del contexto del proyecto: ${tech}.`));
      } else {
        if (cachedContext !== null) {
          console.log(chalk.yellow('⚠ Versión del reviewer cambió — re-detectando stack del proyecto.'));
        }
        foundContextBody = null;
      }
    }
  }

  if (pushShas) {
    const allComments = await githubClient.getPullRequestReviewComments(ctx.owner, ctx.repo, ctx.pullNumber);
    const priorFindings = collectPriorOpenFindings(allComments, githubClient);

    if (priorFindings.length > 0) {
      console.log(chalk.bold(`Revisando PR #${ctx.pullNumber}: ${ctx.title} [modo incremental]`));
      logHeader(tech, config.provider, resolvedModel, config.language);

      const incrementalResult = await runIncrementalReview({
        ctx, config, pushShas, priorFindings, githubClient, mergedRulesText, tech, resolvedModel, projectDigest, opts,
      });

      // false → Compare API error; fall through to full review.
      // null  → no regressions detected; we are done.
      // ReviewPRResult → regressions found and review posted; return it.
      if (incrementalResult !== false) return incrementalResult;
    }
  }

  console.log(chalk.bold(`Revisando PR #${ctx.pullNumber}: ${ctx.title}`));
  logHeader(tech, config.provider, resolvedModel, config.language);

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
  const buildResult = await indexer.build();

  let dependencyIndex: string | undefined;
  if (buildResult.status === 'ok') {
    dependencyIndex = buildResult.index;
    const edgeCount =
      (dependencyIndex.match(/→/g) ?? []).length + (dependencyIndex.match(/←/g) ?? []).length;
    console.log(chalk.dim(`Grafo listo: ${filtered.length} archivos, ${edgeCount} relaciones.`));
    if (dependencyIndex.endsWith('...(truncated)')) {
      console.log(chalk.dim('Grafo truncado a 8.000 caracteres.'));
    }
  } else if (buildResult.status === 'unsupported') {
    console.log(chalk.dim(`Grafo de dependencias: stack "${TechDetector.displayName(tech)}" no soportado, se omite.`));
  } else if (buildResult.status === 'timeout') {
    console.log(chalk.dim('Grafo de dependencias: madge timeout, se omite.'));
  } else {
    console.log(chalk.dim(`Grafo de dependencias: madge falló, se omite.`));
    if (process.env.DEBUG) console.error(chalk.dim(`[DEBUG] madge: ${buildResult.detail}`));
  }

  await loadFileContentBudgeted({ githubClient, ctx, files: filtered });

  const result = await callLLM({
    files: filtered,
    prTitle: ctx.title,
    prBody: ctx.body,
    config,
    mergedRulesText,
    tech,
    resolvedModel,
    dependencyIndex,
    projectDigest,
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

  const beforeSuppression = result.findings.length;
  result.findings = await filterSuppressedFindings({
    githubClient,
    owner: ctx.owner,
    repo: ctx.repo,
    pullNumber: ctx.pullNumber,
    findings: result.findings,
  });
  const suppressed = beforeSuppression - result.findings.length;
  if (suppressed > 0) {
    console.log(chalk.dim(`${suppressed} finding(s) omitidos por estar en la lista de descartados.`));
  }

  const diffLineMap = buildDiffLineMap(filtered);
  console.log(
    chalk.dim(
      `Posteando ${result.findings.length} finding(s) — inline hasta ${config.maxInlineComments}, el resto en el resumen.`,
    ),
  );

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

  // Write context graph after first full review (when no prior context existed).
  if (foundContextBody === null) {
    const contextToSave: ProjectContext = {
      tech,
      appDir: config.appDir,
      reviewerVersion: REVIEWER_VERSION,
      detectedAt: new Date().toISOString(),
    };
    await githubClient.createContextComment({
      owner: ctx.owner,
      repo: ctx.repo,
      pullNumber: ctx.pullNumber,
      body: contextStore.serialize(contextToSave),
    });
    console.log(chalk.dim(`✓ Contexto del proyecto guardado (tech: ${tech}).`));
  }

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
  projectDigest?: string;
}): Promise<ReviewResult> {
  const { files, prTitle, prBody, config, mergedRulesText, tech, resolvedModel, dependencyIndex, projectDigest } = args;

  const promptBuilder = new PromptBuilder();
  const systemPrompt = promptBuilder.buildSystemPrompt({
    config,
    tech,
    mergedRulesText,
    dependencyIndex,
    projectDigest,
  });
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

  if (config.selfCritique?.enabled && parsed.findings.length > 0) {
    console.log(chalk.dim(`Pase de auto-verificación sobre ${parsed.findings.length} finding(s)...`));
    const verifier = new FindingVerifier({ adapter });
    const before = parsed.findings.length;
    parsed.findings = await verifier.verify({
      findings: parsed.findings,
      diffText: userPrompt,
      confidenceThreshold: config.selfCritique.confidenceThreshold,
    });
    const dropped = before - parsed.findings.length;
    if (dropped > 0) {
      console.log(chalk.dim(`Auto-verificación: ${dropped} finding(s) descartados por baja evidencia/confianza.`));
    }
  }

  return { ...parsed, tokensUsed: response.tokensUsed };
}

/**
 * Loads the full post-change content of small/medium changed files (budgeted)
 * so the model sees context beyond the diff (Axis 5). Mutates `content` on the
 * local file objects.
 */
async function loadFileContentBudgeted(args: {
  githubClient: GitHubClient;
  ctx: PullRequestContext;
  files: ReadonlyArray<ChangedFile>;
}): Promise<void> {
  const MAX_FILES = 15;
  const MAX_CHANGES = 400;
  const MAX_BYTES = 40_000;
  let loaded = 0;

  for (const file of args.files) {
    if (loaded >= MAX_FILES) break;
    if (file.status === 'removed' || !file.patch) continue;
    if (file.additions + file.deletions > MAX_CHANGES) continue;

    const content = await args.githubClient.getFileContent(args.ctx, file.path, args.ctx.headSha);
    if (content && content.length <= MAX_BYTES) {
      file.content = content;
      loaded++;
    }
  }
}

/**
 * Removes findings the developer has dismissed as false positives (Axis 2),
 * matched by their position-independent fingerprint.
 */
async function filterSuppressedFindings(args: {
  githubClient: GitHubClient;
  owner: string;
  repo: string;
  pullNumber: number;
  findings: ReadonlyArray<ReviewFinding>;
}): Promise<ReviewFinding[]> {
  const suppressed = await args.githubClient.readSuppressedFingerprints({
    owner: args.owner,
    repo: args.repo,
    pullNumber: args.pullNumber,
  });
  if (suppressed.size === 0) return args.findings.slice();
  return args.findings.filter((f) => !suppressed.has(computeFindingFingerprint(f)));
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
