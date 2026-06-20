# Project Context Index and Risk Report

> **Status:** DRAFT

## 1. Goal

Extend `review-pr` with two capabilities: (1) build a 1-level dependency graph index of the PR's changed files using `madge` and inject it into the LLM system prompt so the reviewer has structural project context; (2) extend `ReviewResult` with two new fields — `anticipatedBugs` and `regressionRisks` — so the LLM produces a proactive bug and regression report in addition to the standard code review findings. The output appears as additional sections in the GitHub PR summary comment.

## 2. Scope

### Included in this phase

- Install `madge` as a production dependency
- New class `DependencyGraphIndexer` at `src/dependency-indexer.ts` that:
  - Accepts the list of changed files from the PR
  - Runs `madge` to resolve 1-level imports (what each changed file imports) and 1-level importers (what files import each changed file)
  - Returns a compact markdown-formatted string for injection into the system prompt
  - Silently returns `null` and logs a `chalk.dim` warning if `madge` fails or the tech stack is unsupported
- Extend `src/types.ts` with `RegressionRisk` interface and two new optional fields on `ReviewResult`: `anticipatedBugs?: ReviewFinding[]` and `regressionRisks?: RegressionRisk[]`
- Update `REVIEW_SCHEMA` in all LLM adapters (`src/llm/openai.ts`, `src/llm/anthropic.ts`, `src/llm/gemini.ts`, `src/llm/ollama.ts`) to include the new fields as required arrays (can be empty)
- Update `SystemPromptArgs` in `src/prompts.ts` to accept optional `dependencyIndex?: string` and inject it as a section in `buildSystemPrompt()`
- Update `src/reviewer.ts`: orchestrate `DependencyGraphIndexer` inside `reviewPullRequest()`, pass index to prompt builder, extend `extractSummaryForPost()` to append the new sections
- Update `src/output.ts` (`OutputFormatter.print()` and `OutputFormatter.toMarkdown()`) to display `anticipatedBugs` and `regressionRisks`
- Update `src/llm/json-parser.ts` (`ReviewJsonParser.validate()`) to parse the new fields
- Feature is active only in `review-pr` — `review-file` and `review-diff` are unchanged

### Out of scope

- `review-file` and `review-diff` commands — no dependency indexing, no risk report
- Caching the index between runs — always regenerated fresh
- Multi-level transitive dependency traversal — 1 level only (direct imports + direct importers)
- Support for non-JS/TS stacks (Flutter, Laravel) — indexer silently skips
- Posting `regressionRisks` as inline comments on caller files — summary comment only
- A separate `--no-index` flag to disable the feature
- Unit tests for `DependencyGraphIndexer` in this phase (requires real temp repos with madge; deferred)
- GitHub Actions workflow changes

## 3. Technologies & Project Conventions

### Stack

- **Language:** TypeScript (ESM, `"type": "module"`)
- **Runtime:** Node.js >= 18
- **Dependency graph tool:** `madge` — static JS/TS import analyzer, supports `tsconfig.json` path aliases, outputs adjacency JSON
- **Build tool:** `tsc` (`tsconfig.json`)
- **Module resolution:** Bundler (`tsconfig.json → moduleResolution: Bundler`)

### Relevant versions

| Dependency | Version | Source |
|---|---|---|
| typescript | ^5.6.0 | `package.json` |
| node | >= 18.0.0 | `package.json` engines |
| madge | latest stable (`npm show madge version` before installing) | to be installed — `package.json` dependencies |

### Existing patterns to follow

- ESM imports use `.js` extension even for `.ts` source files
- CLAUDE.md TypeScript rules apply in full: no `any`/`unknown`, all parameters as typed interface objects, explicit return types, `private readonly` for deps
- All logic in classes — `DependencyGraphIndexer` must be a class, not a module-level function
- Existing output pattern: `chalk.dim(...)` for diagnostic info, `chalk.bold(...)` for headers — follow `src/reviewer.ts` `logHeader()` as reference
- `REVIEW_SCHEMA` is defined as `const ... as const` in each adapter file — follow the same pattern for extending it

## 4. Prerequisites

- [x] `src/types.ts` exports `ReviewResult`, `ReviewFinding`, `ChangedFile` (confirmed)
- [x] `src/prompts.ts` exports `PromptBuilder` with `buildSystemPrompt(args: SystemPromptArgs)` (implemented in previous phase)
- [x] `src/reviewer.ts` has `reviewPullRequest()` with the orchestration pipeline (confirmed)
- [x] `src/github.ts` exports `postReview()` accepting `summary: string` — the summary is built by `extractSummaryForPost()` in `reviewer.ts` (confirmed at `github.ts:148`)
- [x] All LLM adapters (`openai.ts`, `anthropic.ts`, `gemini.ts`, `ollama.ts`) exist under `src/llm/` and each defines its own schema constant (confirmed for `openai.ts` at `src/llm/openai.ts:5`)
- [x] `src/llm/json-parser.ts` exports `ReviewJsonParser` with `parse()` and `validate()` (implemented in previous phase)
- [ ] `madge` installed as a production dependency (`npm install madge`)

## 5. Architecture

### Pattern

Pipeline extension — `DependencyGraphIndexer` runs as the first step inside `reviewPullRequest()`, before the LLM call. Its output (a string or `null`) is threaded through to `PromptBuilder.buildSystemPrompt()`. All other pipeline steps are unchanged.

### Layers affected

| Layer | Affected? | Description |
|---|---|---|
| `src/dependency-indexer.ts` | **Yes (NEW)** | `DependencyGraphIndexer` class — runs madge, formats index |
| `src/types.ts` | **Yes** | Add `RegressionRisk` interface, extend `ReviewResult` |
| `src/prompts.ts` | **Yes** | `SystemPromptArgs` gets `dependencyIndex?: string`; `buildSystemPrompt()` injects it |
| `src/reviewer.ts` | **Yes** | `reviewPullRequest()` orchestrates indexer; `extractSummaryForPost()` appends new sections |
| `src/output.ts` | **Yes** | `print()` and `toMarkdown()` render new fields |
| `src/llm/openai.ts` | **Yes** | `REVIEW_SCHEMA` extended with `anticipatedBugs` and `regressionRisks` |
| `src/llm/anthropic.ts` | **Yes** | Same schema extension |
| `src/llm/gemini.ts` | **Yes** | Same schema extension |
| `src/llm/ollama.ts` | **Yes** | Same schema extension (prompt-based, not json_schema) |
| `src/llm/json-parser.ts` | **Yes** | `validate()` maps new fields |
| `package.json` | **Yes** | Add `madge` to `dependencies` |
| `src/github.ts` | No | `postReview()` receives `summary: string` — no change needed |
| `src/config.ts` | No | No new config keys in this phase |
| `src/tech-detect.ts` | No | `TechDetector` used read-only to skip non-JS/TS stacks |

### Expected flow for `review-pr`

1. `reviewPullRequest()` resolves config + tech stack (unchanged)
2. **NEW:** `new DependencyGraphIndexer({ cwd, files: filtered, tech }).build()` — returns `string | null`
3. If `null`, `chalk.dim` warning is logged; review continues without index
4. LLM call: `promptBuilder.buildSystemPrompt({ config, tech, mergedRulesText, dependencyIndex })` — index injected as last section of system prompt if present
5. LLM responds with extended JSON including `anticipatedBugs` and `regressionRisks`
6. `ReviewJsonParser.parse()` maps the full response to the updated `ReviewResult`
7. `formatter.print(result)` shows all four sections in the terminal
8. `extractSummaryForPost(result)` builds the PR comment body, appending `## Anticipated Bugs` and `## Regression Risks` after findings

### File layout for new files

```
src/
  dependency-indexer.ts    ← NEW: DependencyGraphIndexer class
```

## 6. Files to Create / Modify

| Path | Action | Purpose | Example to follow |
|---|---|---|---|
| `src/dependency-indexer.ts` | CREATE | `DependencyGraphIndexer` class — wraps madge, formats index string | `src/tech-detect.ts` (reads cwd, wraps third-party call, returns typed result) |
| `src/types.ts` | MODIFY | Add `RegressionRisk`, extend `ReviewResult` with `anticipatedBugs?` and `regressionRisks?` | Existing type definitions in same file |
| `src/prompts.ts` | MODIFY | `SystemPromptArgs` + optional index injection in `buildSystemPrompt()` | Existing `buildSystemPrompt()` section pattern |
| `src/reviewer.ts` | MODIFY | Orchestrate indexer in `reviewPullRequest()`; extend `extractSummaryForPost()` | Existing `resolveConfig()` + `reviewPullRequest()` patterns |
| `src/output.ts` | MODIFY | `print()` and `toMarkdown()` render `anticipatedBugs` and `regressionRisks` | Existing findings rendering block in both methods |
| `src/llm/openai.ts` | MODIFY | Extend `REVIEW_SCHEMA` with `anticipatedBugs` and `regressionRisks` | Existing `findings` schema definition |
| `src/llm/anthropic.ts` | MODIFY | Extend JSON field instructions in system prompt suffix | Existing `'\n\nResponde UNICAMENTE con JSON valido...'` suffix at `anthropic.ts:27` |
| `src/llm/gemini.ts` | MODIFY | Extend JSON field instructions in system prompt suffix | Existing `'\n\nResponde UNICAMENTE con JSON valido.'` suffix at `gemini.ts:30` |
| `src/llm/ollama.ts` | MODIFY | Extend JSON field instructions in system prompt suffix | Existing ollama prompt format |
| `src/llm/json-parser.ts` | MODIFY | `validate()` maps new fields; extract `mapFinding()` private method; add `RegressionRiskRaw` interface | Existing `findings` mapping block |
| `package.json` | MODIFY | Add `madge` (latest stable) to `dependencies` | Existing dependency entries |

### Detail per file

#### `src/dependency-indexer.ts` (NEW)

```typescript
interface DependencyGraphIndexerOptions {
  cwd: string;
  files: ReadonlyArray<ChangedFile>;
  tech: TechStack;
}

interface DependencyGraph {
  imports: Record<string, string[]>;   // file → what it imports
  importers: Record<string, string[]>; // file → what imports it
}

export class DependencyGraphIndexer {
  constructor(private readonly options: DependencyGraphIndexerOptions) {}

  async build(): Promise<string | null> { ... }

  private async runMadge(): Promise<DependencyGraph | null> { ... }
  private formatIndex(graph: DependencyGraph): string { ... }
}
```

- `build()` implements a 10-second timeout using `Promise.race`:
  ```typescript
  async build(): Promise<string | null> {
    const supportedStacks: TechStack[] = ['typescript', 'nextjs', 'nestjs', 'react', 'node'];
    if (!supportedStacks.includes(this.options.tech)) return null;

    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000));
    const graph = await Promise.race([this.runMadge(), timeout]);
    if (!graph) return null;
    return this.formatIndex(graph);
  }
  ```
- `runMadge()` uses `const { default: madge } = await import('madge')` then calls `madge(this.options.cwd, { tsConfig: resolve(this.options.cwd, 'tsconfig.json') })` to get the full graph, then filters to only the files in `this.options.files` and their 1-level neighbors. Keys in madge output are relative paths from `cwd` — when comparing against `ChangedFile.path`, ensure both are normalized to the same relative format (no leading `./`).
- `runMadge()` wraps the entire call in try/catch — any error returns `null`
- `formatIndex(graph)` produces a compact markdown string:
  ```
  ## Project context: dependency graph of changed files

  ### Imports (what changed files depend on)
  - `src/auth.ts` → `src/utils/hash.ts`, `src/models/user.ts`

  ### Importers (callers that may be affected)
  - `src/auth.ts` ← `src/routes/login.ts`, `src/routes/profile.ts`
  ```
- Graph string is truncated to 8,000 characters to avoid blowing the context window
- Must NOT import `madge` at module level — use dynamic `await import('madge')` to avoid crashing when madge is absent

#### `src/types.ts` (MODIFY)

Add after `ReviewFinding`:

```typescript
export interface RegressionRisk {
  file: string;
  symbol: string;
  reason: string;
}
```

Extend `ReviewResult` with two new optional fields:

```typescript
export interface ReviewResult {
  // ... existing fields ...
  anticipatedBugs?: ReviewFinding[];
  regressionRisks?: RegressionRisk[];
}
```

#### `src/prompts.ts` (MODIFY)

Extend `SystemPromptArgs`:

```typescript
interface SystemPromptArgs {
  config: ReviewerConfig;
  tech: TechStack;
  mergedRulesText: string;
  dependencyIndex?: string;  // NEW — formatted graph string or undefined
}
```

In `buildSystemPrompt()`, if `dependencyIndex` is present, push it as a section after `mergedRulesText` and before the line-referencing instructions. The section must include explicit guidance that distinguishes `anticipatedBugs` from `findings`:

```typescript
if (args.dependencyIndex) {
  sections.push(args.dependencyIndex);
  sections.push(
    `**How to use the dependency context above:**
- \`findings\`: issues that already exist in the diff (real bugs, code smells, security issues visible in the changed lines).
- \`anticipatedBugs\`: bugs that DO NOT exist yet but are likely to be introduced by this change — think about what could go wrong at runtime given the logic change.
- \`regressionRisks\`: for each caller listed in "Importers" above, reason about whether this change could break that caller. Return one entry per caller at risk. If the caller is safe, omit it.
Both \`anticipatedBugs\` and \`regressionRisks\` can be empty arrays if the change is safe.`
  );
}
```

Must NOT change the order of existing sections in `buildSystemPrompt()`.

#### `src/reviewer.ts` (MODIFY)

Inside `reviewPullRequest()`, after `filtered` is computed and before `callLLM`:

```typescript
const indexer = new DependencyGraphIndexer({ cwd, files: filtered, tech });
const dependencyIndex = await indexer.build();
if (!dependencyIndex) {
  console.log(chalk.dim('Dependency index: not available for this stack or madge failed — continuing without it.'));
}
```

Pass `dependencyIndex` into `callLLM()` which passes it to `promptBuilder.buildSystemPrompt()`.

Extend `extractSummaryForPost()` to append new sections:

```typescript
if (result.anticipatedBugs && result.anticipatedBugs.length > 0) {
  // append ## Anticipated Bugs section
}
if (result.regressionRisks && result.regressionRisks.length > 0) {
  // append ## Regression Risks section
}
```

#### `src/llm/openai.ts` (MODIFY)

Extend `REVIEW_SCHEMA.schema.properties` with:

```typescript
anticipatedBugs: {
  type: 'array',
  description: 'Bugs that are not present yet but are likely to surface given these changes.',
  items: { /* same shape as findings items */ },
},
regressionRisks: {
  type: 'array',
  description: 'Callers or consumers of the changed code that may break.',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      file: { type: 'string' },
      symbol: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['file', 'symbol', 'reason'],
  },
},
```

Add `'anticipatedBugs'` and `'regressionRisks'` to `required` array. Both can be empty arrays.

Must NOT change the existing `findings` item shape or any existing `required` fields.

#### `src/llm/anthropic.ts` (MODIFY)

`AnthropicAdapter` has no `REVIEW_SCHEMA` constant. It appends a plain-text JSON instruction to the system prompt at `anthropic.ts:27`:

```
'\n\nResponde UNICAMENTE con JSON valido, sin markdown ni texto adicional.'
```

Extend this suffix to describe the new fields:

```
'\n\nResponde UNICAMENTE con JSON valido, sin markdown ni texto adicional. ' +
'El JSON debe incluir los campos: summary, overallScore, recommendation, findings, anticipatedBugs y regressionRisks. ' +
'anticipatedBugs sigue el mismo schema que findings. ' +
'regressionRisks es un array de { file: string, symbol: string, reason: string }. ' +
'Ambos pueden ser arrays vacíos.'
```

Must NOT add a `REVIEW_SCHEMA` constant — use the prompt suffix approach exclusively for this adapter.

#### `src/llm/gemini.ts` (MODIFY)

`GeminiAdapter` appends `'\n\nResponde UNICAMENTE con JSON valido.'` at `gemini.ts:30`. Apply the same extended suffix as `anthropic.ts` above.

Must NOT change `responseMimeType` or add a schema object — Gemini's structured output in this codebase is prompt-driven only.

#### `src/llm/ollama.ts` (MODIFY)

Apply the same extended suffix pattern. Consult the existing suffix location in `ollama.ts` before editing.

#### `src/llm/json-parser.ts` (MODIFY)

Add a typed raw interface before the class definition to avoid `Record<string, unknown>` casts (CLAUDE.md prohibits bare `unknown`):

```typescript
interface FindingRaw {
  file: unknown;
  line: unknown;
  severity: unknown;
  category: unknown;
  title: unknown;
  description: unknown;
  suggestion: unknown;
}

interface RegressionRiskRaw {
  file: unknown;
  symbol: unknown;
  reason: unknown;
}
```

Extract the existing per-finding mapping into a private `mapFinding(f: FindingRaw): ReviewFinding` method. Then in `validate()`, after the existing `findings` block, add:

```typescript
anticipatedBugs: Array.isArray(obj.anticipatedBugs)
  ? (obj.anticipatedBugs as FindingRaw[]).map((f) => this.mapFinding(f))
  : [],
regressionRisks: Array.isArray(obj.regressionRisks)
  ? (obj.regressionRisks as RegressionRiskRaw[]).map((r) => ({
      file: (r.file as string) ?? '',
      symbol: (r.symbol as string) ?? '',
      reason: (r.reason as string) ?? '',
    }))
  : [],
```

Must NOT use bare `Record<string, unknown>` casts — use the typed raw interfaces above. Must NOT change the existing `findings` mapping logic, only extract it into `mapFinding()`.

## 7. API Contract

Sin API surface — no new HTTP endpoints or GitHub API calls. The only interface change is the JSON schema passed to LLM providers (internal).

## 8. Success Criteria

- [ ] `npm run build` passes with zero TypeScript errors after all changes
- [ ] `npm test` — all existing tests pass (no regressions from type changes or schema extensions)
- [ ] `npm run dev -- review-pr --dry-run` in a GitHub Actions context generates a PR comment body that contains `## Anticipated Bugs` and `## Regression Risks` sections
- [ ] When run against a TS/JS repo with resolvable imports, the system prompt sent to the LLM contains the `## Project context: dependency graph of changed files` section
- [ ] When `madge` fails (e.g., no `node_modules`, invalid tsconfig), the review completes successfully without the index and logs the `chalk.dim` warning
- [ ] When the tech stack is `flutter` or `laravel`, the indexer returns `null` silently and the review proceeds unchanged

### Tests required

No new tests in this phase (deferred — `DependencyGraphIndexer` requires real temp repos with full `node_modules` to meaningfully test madge). Existing test suite must continue to pass.

### Verification commands

```bash
npm run build
npm test
```

## 9. UX Criteria

### Loading

All CLI strings are defined canonically in Section 16. The messages appear between the header (`logHeader()`) and the `chalk.dim('Llamando a ...')` LLM line.

### Errors

- `madge` failure → `chalk.dim` warning (see Section 16 for exact string), review continues. Full stack trace only if `DEBUG` env var is set.
- Missing `tsconfig.json` → madge runs without tsconfig path resolution (relative imports only); not a failure.

### Navigation

Not applicable — CLI only.

### Accessibility

Not applicable — CLI only.

### Formularios / Passwords

Not applicable.

## 10. Decisions Made (Locked)

- **`madge` for dependency analysis** — chosen over `ts-morph` (too heavy) and regex parsers (no tsconfig alias support). Installed as production dependency, not optional, to ensure availability in CI.
- **`anticipatedBugs` is `ReviewFinding[]`** — reuses existing type; the LLM uses the same schema fields. Reviewers and GitHub posting logic treat them identically to `findings`.
- **`regressionRisks` is `RegressionRisk[]` with `{ file, symbol, reason }`** — structured and actionable. Not `ReviewFinding[]` because regression risks reference *callers*, not lines in the diff.
- **`review-pr` only** — indexing requires the full checked-out repo and known file list. `review-file` and `review-diff` are unchanged in this phase.
- **No caching** — index is regenerated fresh per run. The 1-level madge call is fast (<2s on repos up to 500 files). Caching adds staleness risk with no measurable benefit at this scale.
- **Index in system prompt, not user prompt** — structural project context is model-level, not PR-specific. System prompt is the correct slot.
- **`anticipatedBugs` and `regressionRisks` are required in the LLM schema** (can be empty arrays) — the LLM always reasons about them; empty arrays are a valid and expected output for clean PRs.
- **Optional in `ReviewResult` TypeScript interface** — `anticipatedBugs?` and `regressionRisks?` are optional to avoid breaking code that constructs `ReviewResult` without them (tests, mocks, older callers).
- **Dynamic import of `madge`** — `await import('madge')` used instead of top-level import to avoid a startup crash if madge is missing from the environment.
- **8,000 character cap on the index string** — prevents the dependency graph from dominating the context window in repos with many interdependencies.

## 11. Edge Cases

### Invalid data

- Changed file not in the madge graph (e.g., new file with no imports yet) → include it with empty import/importer lists, do not throw
- Circular import (A → B → A) → madge handles it natively; the graph includes both edges; no special treatment needed
- Dynamic import with variable (`import(variable)`) → madge cannot resolve it; skip that edge silently
- File with syntax errors → madge throws for that file; catch per-file, skip the file, continue with the rest

### Failure modes

- `madge` throws on the entire run → `build()` catches, logs `chalk.dim` warning, returns `null`
- `tsconfig.json` not found → madge runs without tsconfig path resolution (relative imports only); not a fatal error
- Graph string exceeds 8,000 characters → truncate at 8,000 chars, append `\n...(truncated)`
- No changed files after filtering → indexer returns `null` immediately without calling madge
- `anticipatedBugs` or `regressionRisks` absent from LLM response → `ReviewJsonParser.validate()` defaults to empty arrays, no throw

### Non-TS stacks

- `flutter`, `laravel`, `generic` → `build()` returns `null` immediately, no madge call
- `node` (plain JS, no tsconfig) → madge runs without tsconfig option; relative requires are resolved

### Context window

- Very large graph (50+ changed files with many importers) → graph string is truncated at 8,000 chars before injection into the system prompt

## 12. Required UI States

See Section 16 for the canonical Spanish strings for each state.

| State | CLI output | User action |
|---|---|---|
| Index generated successfully | `chalk.dim(...)` — see Section 16 | None |
| Index skipped (unsupported stack) | `chalk.dim(...)` — see Section 16 | None |
| Index failed (madge error) | `chalk.dim(...)` — see Section 16 | None — review continues |
| Index truncated | `chalk.dim(...)` — see Section 16; truncated string injected into prompt | None |

## 13. Validations

### Client-side

| Field | Rule | Behavior on failure |
|---|---|---|
| `anticipatedBugs` | Must be array (or absent) | Default to `[]` in `ReviewJsonParser` |
| `regressionRisks` | Must be array (or absent) | Default to `[]` in `ReviewJsonParser` |
| `regressionRisks[].file` | Must be string | Default to `''` in `ReviewJsonParser` |
| `regressionRisks[].symbol` | Must be string | Default to `''` in `ReviewJsonParser` |
| `regressionRisks[].reason` | Must be string | Default to `''` in `ReviewJsonParser` |

### Server-side validations

Not applicable — no external API surface.

## 14. Security & Permissions

- The dependency graph string contains internal file paths and import relationships. It is sent to the configured LLM provider. This is consistent with sending the full file diffs; no additional exposure beyond what already happens.
- The graph string is never written to disk — it is constructed in memory and discarded after the LLM call.
- `madge` is called with `execFileSync`-equivalent API (madge's programmatic API) — no shell involved, no injection risk.
- No new environment variables required.

## 15. Observability & Logging

Using `chalk.dim(...)` consistent with the existing pattern in `src/reviewer.ts` `logHeader()`:

| Event | Log |
|---|---|
| Indexer starting | `chalk.dim('Analizando grafo de dependencias...')` |
| Index ready | `chalk.dim('Grafo listo: ${fileCount} archivos, ${edgeCount} relaciones.')` |
| Index skipped (stack) | `chalk.dim('Grafo de dependencias: stack no soportado, se omite.')` |
| madge failure | `chalk.dim('Grafo de dependencias: madge falló, se omite.')` + full stack trace if `DEBUG` env var is set |
| Index truncated | `chalk.dim('Grafo truncado a 8.000 caracteres.')` |

Never log: the full graph string (too verbose), file contents, or LLM prompts.

## 16. i18n / User-facing copy

All CLI output is in Spanish (rioplatense) — this is enforced in CLAUDE.md. New strings:

| Context | String |
|---|---|
| Indexer start | `Analizando grafo de dependencias...` |
| Index ready | `Grafo listo: {N} archivos, {M} relaciones.` |
| Index skipped | `Grafo de dependencias: stack no soportado, se omite.` |
| madge failure | `Grafo de dependencias: madge falló, se omite.` |
| Index truncated | `Grafo truncado a 8.000 caracteres.` |
| Terminal section header | `Bugs Anticipados ({N}):` |
| Terminal section header | `Riesgos de Regresión ({N}):` |
| GitHub PR comment section | `## 🐛 Bugs Anticipados` |
| GitHub PR comment section | `## ⚠️ Riesgos de Regresión` |

The LLM's output language (content of `anticipatedBugs` descriptions and `regressionRisks.reason`) is controlled by `config.language` and the existing language instruction in `buildSystemPrompt()` — no change needed.

## 17. Performance

- `madge` programmatic call on a 1-level graph of 50 files completes in < 2 seconds on Node 18+
- No parallelization needed — madge runs once per `review-pr` invocation
- The 8,000 character cap on the index string ensures the LLM context window budget is not exceeded
- `DependencyGraphIndexer.build()` must complete before the LLM call — no streaming or lazy evaluation
- If madge takes longer than 10 seconds, abort with a `Promise.race` timeout and return `null` (treat as madge failure)

## 18. Restrictions

- Do NOT add dependency indexing to `review-file` or `review-diff` — this phase is `review-pr` only
- Do NOT change the `ReviewFinding` schema — `anticipatedBugs` reuses it without modification
- Do NOT add a config key to enable/disable the indexer in this phase — it is always-on for supported stacks
- Do NOT write the graph to disk at any point
- Do NOT use multi-turn LLM calls — remain single-call
- Do NOT change `postReview()` in `src/github.ts` — all changes go into `extractSummaryForPost()` in `reviewer.ts`
- Do NOT add new `CheckCategory` values for anticipated bugs — the existing categories apply

## 19. Deliverables

- [ ] `src/dependency-indexer.ts` created with `DependencyGraphIndexer` class
- [ ] `src/types.ts` updated with `RegressionRisk` and extended `ReviewResult`
- [ ] `src/prompts.ts` updated — `SystemPromptArgs.dependencyIndex` + injection in `buildSystemPrompt()`
- [ ] `src/reviewer.ts` updated — indexer orchestration + `extractSummaryForPost()` extended
- [ ] `src/output.ts` updated — `print()` and `toMarkdown()` render new sections
- [ ] `src/llm/openai.ts` updated — `REVIEW_SCHEMA` extended
- [ ] `src/llm/anthropic.ts` updated — schema extended
- [ ] `src/llm/gemini.ts` updated — schema extended
- [ ] `src/llm/ollama.ts` updated — schema extended
- [ ] `src/llm/json-parser.ts` updated — `validate()` maps new fields
- [ ] `package.json` updated — `madge` added to `dependencies`
- [ ] `npm run build` passes
- [ ] `npm test` — all 71 existing tests pass

## 20. Final Agent Checklist

- [ ] Read this spec end-to-end before writing any code
- [ ] Confirmed `src/llm/openai.ts:5` — `REVIEW_SCHEMA` location and `strict: true` constraint
- [ ] Confirmed `src/github.ts:148` — `postReview()` signature unchanged
- [ ] Confirmed `src/reviewer.ts` — `extractSummaryForPost()` is the correct extension point
- [ ] `madge` installed before attempting to import it
- [ ] Dynamic `await import('madge')` used — no top-level import
- [ ] All new interfaces have explicit return types and typed parameter objects
- [ ] No `any` or `unknown` without narrowing
- [ ] Modified only the files listed in section 6
- [ ] `anticipatedBugs` and `regressionRisks` are `required` in the LLM schema but `optional` (`?`) in the TypeScript `ReviewResult` interface
- [ ] `extractSummaryForPost()` appends new sections only when arrays are non-empty
- [ ] madge failure path tested manually against a repo without `node_modules`
- [ ] `npm run build` passes with zero errors
- [ ] `npm test` — all 71 tests pass (no regressions)
- [ ] No temporary `console.log` statements or TODO comments left in code
