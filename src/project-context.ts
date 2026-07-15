import { createRequire } from 'node:module';
import type { ProjectContext } from './types.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const REVIEWER_VERSION: string = _pkg.version;

const MARKER_START = '<!-- ai-review-context:';
const MARKER_END = ' -->';
const VISIBLE_LABEL = '_🤖 Contexto del proyecto — generado automáticamente._\n';

const VALID_TECH_STACKS = new Set([
  'nestjs', 'react', 'nextjs', 'typescript', 'node', 'flutter', 'laravel', 'generic',
]);

export class ProjectContextStore {
  serialize(context: ProjectContext): string {
    return VISIBLE_LABEL + MARKER_START + JSON.stringify(context) + MARKER_END;
  }

  deserialize(body: string): ProjectContext | null {
    const start = body.indexOf(MARKER_START);
    if (start === -1) return null;

    const jsonStart = start + MARKER_START.length;
    const end = body.indexOf(MARKER_END, jsonStart);
    if (end === -1) return null;

    const raw = body.slice(jsonStart, end);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;

    if (
      typeof obj['tech'] !== 'string' ||
      !VALID_TECH_STACKS.has(obj['tech']) ||
      typeof obj['reviewerVersion'] !== 'string' ||
      !obj['reviewerVersion'] ||
      typeof obj['detectedAt'] !== 'string' ||
      !obj['detectedAt']
    ) {
      return null;
    }

    const suppressed = Array.isArray(obj['suppressedFingerprints'])
      ? (obj['suppressedFingerprints'] as unknown[]).filter(
          (item): item is string => typeof item === 'string',
        )
      : undefined;

    const stackMap = this.parseStackMap(obj['stackMap']);

    return {
      tech: obj['tech'] as ProjectContext['tech'],
      appDir: typeof obj['appDir'] === 'string' ? obj['appDir'] : undefined,
      reviewerVersion: obj['reviewerVersion'],
      detectedAt: obj['detectedAt'],
      ...(suppressed !== undefined ? { suppressedFingerprints: suppressed } : {}),
      ...(stackMap !== undefined ? { stackMap } : {}),
    };
  }

  private parseStackMap(raw: unknown): ReadonlyArray<{ dir: string; tech: ProjectContext['tech'] }> | undefined {
    if (!Array.isArray(raw)) return undefined;

    const entries: Array<{ dir: string; tech: ProjectContext['tech'] }> = [];
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) return undefined;
      const entry = item as Record<string, unknown>;
      if (typeof entry['dir'] !== 'string') return undefined;
      if (typeof entry['tech'] !== 'string' || !VALID_TECH_STACKS.has(entry['tech'])) return undefined;
      entries.push({ dir: entry['dir'], tech: entry['tech'] as ProjectContext['tech'] });
    }
    return entries;
  }

  shouldInvalidate(context: ProjectContext): boolean {
    return context.reviewerVersion !== REVIEWER_VERSION;
  }
}
