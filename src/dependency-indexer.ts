import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type madge from 'madge';
import type { ChangedFile, TechStack } from './types.js';

type MadgeFn = typeof madge;

interface DependencyGraphIndexerOptions {
  cwd: string;
  files: ReadonlyArray<ChangedFile>;
  tech: TechStack;
}

interface DependencyGraph {
  imports: Record<string, string[]>;
  importers: Record<string, string[]>;
}

const SUPPORTED_STACKS: ReadonlyArray<TechStack> = [
  'typescript',
  'nextjs',
  'nestjs',
  'react',
  'node',
];

const MAX_INDEX_CHARS = 8_000;
const MADGE_TIMEOUT_MS = 10_000;

export class DependencyGraphIndexer {
  constructor(private readonly options: DependencyGraphIndexerOptions) {}

  async build(): Promise<string | null> {
    if (!SUPPORTED_STACKS.includes(this.options.tech)) return null;
    if (this.options.files.length === 0) return null;

    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), MADGE_TIMEOUT_MS));
    const graph = await Promise.race([this.runMadge(), timeout]);
    if (!graph) return null;

    return this.formatIndex(graph);
  }

  private async runMadge(): Promise<DependencyGraph | null> {
    try {
      const { default: madge } = (await import('madge')) as { default: MadgeFn };

      const tsConfigPath = resolve(this.options.cwd, 'tsconfig.json');
      const madgeOptions = existsSync(tsConfigPath)
        ? { tsConfig: tsConfigPath }
        : {};

      const result = await madge(this.options.cwd, madgeOptions);
      const fullGraph = result.obj();

      const changedPaths = new Set(
        this.options.files.map((f) => this.normalizePath(f.path)),
      );

      const imports: Record<string, string[]> = {};
      const importers: Record<string, string[]> = {};

      for (const changedPath of changedPaths) {
        const directImports = fullGraph[changedPath] ?? [];
        if (directImports.length > 0) {
          imports[changedPath] = directImports;
        }
      }

      for (const [file, deps] of Object.entries(fullGraph)) {
        const normalizedFile = this.normalizePath(file);
        for (const dep of deps) {
          const normalizedDep = this.normalizePath(dep);
          if (changedPaths.has(normalizedDep)) {
            if (!importers[normalizedDep]) importers[normalizedDep] = [];
            importers[normalizedDep].push(normalizedFile);
          }
        }
      }

      return { imports, importers };
    } catch {
      return null;
    }
  }

  private formatIndex(graph: DependencyGraph): string {
    const lines: string[] = [
      '## Project context: dependency graph of changed files',
      '',
    ];

    const importEntries = Object.entries(graph.imports);
    const importerEntries = Object.entries(graph.importers);

    if (importEntries.length > 0) {
      lines.push('### Imports (what changed files depend on)', '');
      for (const [file, deps] of importEntries) {
        lines.push(`- \`${file}\` → ${deps.map((d) => `\`${d}\``).join(', ')}`);
      }
      lines.push('');
    }

    if (importerEntries.length > 0) {
      lines.push('### Importers (callers that may be affected)', '');
      for (const [file, callers] of importerEntries) {
        lines.push(`- \`${file}\` ← ${callers.map((c) => `\`${c}\``).join(', ')}`);
      }
      lines.push('');
    }

    if (importEntries.length === 0 && importerEntries.length === 0) {
      lines.push('_No resolvable dependencies found for the changed files._', '');
    }

    const result = lines.join('\n');
    if (result.length > MAX_INDEX_CHARS) {
      return result.slice(0, MAX_INDEX_CHARS) + '\n...(truncated)';
    }
    return result;
  }

  private normalizePath(filePath: string): string {
    return filePath.startsWith('./') ? filePath.slice(2) : filePath;
  }
}
