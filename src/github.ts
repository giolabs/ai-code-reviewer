import { readFileSync, existsSync } from 'node:fs';
import { Octokit } from '@octokit/rest';
import type { ChangedFile, PullRequestContext, ReviewFinding } from './types.js';

/**
 * Lee el contexto del PR desde las variables de entorno que GitHub Actions
 * inyecta. Si no estamos en Actions, devuelve null.
 *
 * Variables relevantes:
 * - GITHUB_REPOSITORY → "owner/repo"
 * - GITHUB_EVENT_PATH → path al JSON del evento (incluye PR number, SHAs, etc.)
 * - GITHUB_TOKEN → token con permisos pull-requests:write
 */
export function getPullRequestContextFromEnv(): PullRequestContext | null {
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!repository || !eventPath || !existsSync(eventPath)) {
    return null;
  }

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) return null;

  let event: unknown;
  try {
    event = JSON.parse(readFileSync(eventPath, 'utf-8'));
  } catch {
    return null;
  }

  if (typeof event !== 'object' || event === null) return null;
  const eventObj = event as Record<string, unknown>;

  // El evento pull_request tiene esta estructura.
  // También soportamos pull_request_target (mismo shape).
  const pr = eventObj.pull_request as Record<string, unknown> | undefined;
  if (!pr) return null;

  const head = pr.head as Record<string, unknown> | undefined;
  const base = pr.base as Record<string, unknown> | undefined;

  return {
    owner,
    repo,
    pullNumber: pr.number as number,
    headSha: (head?.sha as string) ?? '',
    baseSha: (base?.sha as string) ?? '',
    title: (pr.title as string) ?? '',
    body: (pr.body as string | null) ?? null,
  };
}

/**
 * Crea un cliente Octokit autenticado con GITHUB_TOKEN.
 */
export function createOctokit(token = process.env.GITHUB_TOKEN): Octokit {
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN no está definido. En GitHub Actions, pasalo como env:\n' +
        '  env:\n' +
        '    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    );
  }
  return new Octokit({ auth: token });
}

/**
 * Obtiene los archivos cambiados en un PR. Usa la API de GitHub que devuelve
 * paginated results con el patch ya generado.
 */
export async function getPullRequestFiles(
  octokit: Octokit,
  ctx: PullRequestContext,
): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];

  // La API pagina de a 100 archivos máximo
  for await (const response of octokit.paginate.iterator(octokit.pulls.listFiles, {
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pullNumber,
    per_page: 100,
  })) {
    for (const file of response.data) {
      files.push({
        path: file.filename,
        status: normalizeStatus(file.status),
        patch: file.patch,
        additions: file.additions,
        deletions: file.deletions,
      });
    }
  }

  return files;
}

function normalizeStatus(status: string): ChangedFile['status'] {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

/**
 * Obtiene el contenido completo de un archivo en un SHA específico. Útil para
 * dar más contexto al modelo además del patch.
 */
export async function getFileContent(
  octokit: Octokit,
  ctx: PullRequestContext,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const response = await octokit.repos.getContent({
      owner: ctx.owner,
      repo: ctx.repo,
      path,
      ref,
    });

    if (Array.isArray(response.data)) return null; // es un directorio
    if (response.data.type !== 'file') return null;
    if (!('content' in response.data)) return null;

    return Buffer.from(response.data.content, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * Postea un review en el PR con summary + inline comments.
 *
 * - Si `summary` está vacío y no hay findings inline, no postea nada.
 * - Los findings con línea inválida (no presente en el diff) se degradan a
 *   menciones dentro del summary, porque GitHub rechaza inline comments
 *   sobre líneas que no fueron cambiadas.
 */
export async function postReview(
  octokit: Octokit,
  ctx: PullRequestContext,
  args: {
    summary: string;
    findings: ReviewFinding[];
    event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';
    inlineComments: boolean;
    maxInlineComments: number;
    diffLineMap: Map<string, Set<number>>;
  },
): Promise<void> {
  const { summary, findings, event, inlineComments, maxInlineComments, diffLineMap } = args;

  // Findings que caen sobre líneas del diff → inline comments.
  // El resto se mergea al final del summary.
  const inline: { path: string; line: number; body: string }[] = [];
  const orphans: ReviewFinding[] = [];

  if (inlineComments) {
    for (const f of findings) {
      const fileDiff = diffLineMap.get(f.file);
      if (fileDiff?.has(f.line) && inline.length < maxInlineComments) {
        inline.push({
          path: f.file,
          line: f.line,
          body: formatInlineCommentBody(f),
        });
      } else {
        orphans.push(f);
      }
    }
  } else {
    orphans.push(...findings);
  }

  const finalSummary = composeSummary(summary, orphans);

  await octokit.pulls.createReview({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pullNumber,
    commit_id: ctx.headSha,
    event,
    body: finalSummary,
    comments: inline.map((c) => ({
      path: c.path,
      line: c.line,
      side: 'RIGHT',
      body: c.body,
    })),
  });
}

function severityEmoji(severity: ReviewFinding['severity']): string {
  switch (severity) {
    case 'critical':
      return '🔴';
    case 'major':
      return '🟠';
    case 'minor':
      return '🟡';
    case 'info':
      return '🔵';
    case 'nitpick':
      return '⚪';
  }
}

function formatInlineCommentBody(f: ReviewFinding): string {
  const lines = [
    `${severityEmoji(f.severity)} **${f.severity.toUpperCase()}** · \`${f.category}\` · ${f.title}`,
    '',
    f.description,
  ];
  if (f.suggestion) {
    lines.push('', '**Sugerencia:**', '', f.suggestion);
  }
  return lines.join('\n');
}

function composeSummary(summary: string, orphans: ReviewFinding[]): string {
  const parts = ['## 🤖 AI Code Review', '', summary];

  if (orphans.length > 0) {
    parts.push(
      '',
      '### Observaciones adicionales',
      '',
      '_(Estos findings refieren a líneas fuera del diff de este PR o no pudieron mapearse a inline comments.)_',
      '',
    );
    for (const f of orphans) {
      parts.push(
        `- ${severityEmoji(f.severity)} **${f.severity.toUpperCase()}** \`${f.file}:${f.line}\` · ${f.category}: **${f.title}** — ${f.description}`,
      );
    }
  }

  parts.push('', '---', '_Generado por [ai-code-reviewer](https://www.npmjs.com/package/ai-code-reviewer)._');
  return parts.join('\n');
}

/**
 * Parsea un patch unificado y devuelve, por cada archivo, el set de números
 * de línea del lado "nuevo" (RIGHT) que fueron tocados. Solo esas líneas son
 * commentable inline por GitHub.
 */
export function buildDiffLineMap(files: ChangedFile[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();

  for (const file of files) {
    if (!file.patch) continue;
    const lines = new Set<number>();
    const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
    let currentNewLine = 0;

    for (const line of file.patch.split('\n')) {
      const match = hunkHeader.exec(line);
      if (match) {
        currentNewLine = parseInt(match[1], 10);
        continue;
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lines.add(currentNewLine);
        currentNewLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // línea eliminada, no avanza el contador del lado nuevo
      } else if (line.startsWith(' ')) {
        currentNewLine++;
      }
    }

    map.set(file.path, lines);
  }

  return map;
}
