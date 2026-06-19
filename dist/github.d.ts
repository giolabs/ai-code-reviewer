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
export declare function getPullRequestContextFromEnv(): PullRequestContext | null;
/**
 * Crea un cliente Octokit autenticado con GITHUB_TOKEN.
 */
export declare function createOctokit(token?: string | undefined): Octokit;
/**
 * Obtiene los archivos cambiados en un PR. Usa la API de GitHub que devuelve
 * paginated results con el patch ya generado.
 */
export declare function getPullRequestFiles(octokit: Octokit, ctx: PullRequestContext): Promise<ChangedFile[]>;
/**
 * Obtiene el contenido completo de un archivo en un SHA específico. Útil para
 * dar más contexto al modelo además del patch.
 */
export declare function getFileContent(octokit: Octokit, ctx: PullRequestContext, path: string, ref: string): Promise<string | null>;
/**
 * Postea un review en el PR con summary + inline comments.
 *
 * - Si `summary` está vacío y no hay findings inline, no postea nada.
 * - Los findings con línea inválida (no presente en el diff) se degradan a
 *   menciones dentro del summary, porque GitHub rechaza inline comments
 *   sobre líneas que no fueron cambiadas.
 */
export declare function postReview(octokit: Octokit, ctx: PullRequestContext, args: {
    summary: string;
    findings: ReviewFinding[];
    event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';
    inlineComments: boolean;
    maxInlineComments: number;
    diffLineMap: Map<string, Set<number>>;
}): Promise<void>;
/**
 * Parsea un patch unificado y devuelve, por cada archivo, el set de números
 * de línea del lado "nuevo" (RIGHT) que fueron tocados. Solo esas líneas son
 * commentable inline por GitHub.
 */
export declare function buildDiffLineMap(files: ChangedFile[]): Map<string, Set<number>>;
