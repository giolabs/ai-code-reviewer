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

    return {
      tech: obj['tech'] as ProjectContext['tech'],
      appDir: typeof obj['appDir'] === 'string' ? obj['appDir'] : undefined,
      reviewerVersion: obj['reviewerVersion'],
      detectedAt: obj['detectedAt'],
    };
  }

  shouldInvalidate(context: ProjectContext): boolean {
    return context.reviewerVersion !== REVIEWER_VERSION;
  }
}
