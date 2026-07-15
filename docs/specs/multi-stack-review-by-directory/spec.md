# Multi-Stack Review by Directory

> **Status:** DRAFT

## 1. Goal

Let a single PR that spans multiple subprojects with different tech stacks (e.g. `apps/web` Flutter, `packages/shared_types` Dart, a future `apps/api` NestJS) get reviewed with the *correct* stack-specific rules for every changed file, instead of one stack detected once and applied uniformly to the whole PR.

Today `appDir` in `.ai-review.yml` is a single optional string used once, at the start of the pipeline, to pick the `cwd` `TechDetector` runs against. The result is one `TechStack`, one rules template, and one system prompt for every file in the PR — regardless of which subdirectory a given file actually lives in. On a real monorepo (`giolabs/flowstore`) this means a Flutter app and a separate Dart package share one detected stack (works by luck, since both happen to be Flutter/Dart), and any future non-Dart subproject (a Node backend, a docs site) would be reviewed with the wrong template or silently fall back to `generic`.

This spec turns `appDir` into a list of subproject directories, detects the stack independently for each one, groups changed files by the directory they fall under, runs one review pass per group with that group's own rules/system prompt, and merges the per-group results into the single PR review GitHub actually sees (one summary comment, one event, inline comments tagged to their own file).

## 2. Scope

### Included in this phase

- `appDir: string | string[]` in `.ai-review.yml` (backward compatible with the existing single-string form).
- Per-directory stack detection (`TechDetector`), longest-prefix file→directory assignment, root/fallback stack for files outside every configured `appDir`.
- One LLM review call per detected stack group (full review and incremental review), with a `maxStackGroups` cap that degrades excess groups into the fallback group instead of spawning unbounded LLM calls.
- Merge of N `ReviewResult`s into one: worst-recommendation-wins, min-score-wins, concatenated summary/findings.
- Per-group dependency graph (`DependencyGraphIndexer`) using that group's own `appCwd`.
- Cached project-context comment upgraded to store a `dir → tech` map instead of a single `tech`.
- `EXAMPLE_CONFIG` (`src/cli.ts`) documentation for the new shape.

### Out of scope

- Per-file stack detection finer than directory-level (e.g. two stacks mixed inside the same directory) — not a real case observed yet.
- Parallelizing the per-group LLM calls — this phase runs groups sequentially for simpler logs and predictable rate-limit behavior; parallelizing is a future optimization, not required for correctness.
- Migrating existing single-string `appDir` configs — they keep working unchanged, normalized internally to a one-element array.
- Cross-stack findings (e.g. "this Dart model doesn't match this TS DTO") — each group is reviewed independently; no cross-group reasoning.

## 3. Design

### 3.1 Config shape (`src/types.ts`, `src/config.ts`)

```ts
// ReviewerConfig
appDir?: string | ReadonlyArray<string>;
maxStackGroups: number; // default 4
```

`ConfigLoader.loadConfig()` already spreads unknown-shaped fields (`...parsed`) onto `DEFAULT_CONFIG`, so `appDir` as an array needs no special-case merge — only `maxStackGroups: parsed.maxStackGroups ?? 4` needs adding to `DEFAULT_CONFIG` (mirrors how `maxInlineComments` is defaulted today).

A single string is normalized to a one-element array at the point of use (`StackGrouper`), not in `config.ts` — keeps the config type honest about what the user wrote (needed to detect "user changed their appDir list" for cache invalidation, see 3.4).

### 3.2 Per-directory detection (`src/tech-detect.ts`)

`TechDetector.detect()` (tech-detect.ts:26) takes no arguments and reads `this.cwd`, set once in the constructor — there is no way to point an existing instance at a different directory, and `detect()`'s signature must not change (every other caller passes zero args). `detectAll()` therefore does **not** call `detect()` on `this` — it constructs one fresh `new TechDetector({ cwd: resolve(this.cwd, dir) })` per directory and calls `.detect()` on each:

```ts
// TechDetector
detectAll(dirs: ReadonlyArray<string>): ReadonlyArray<{ dir: string; tech: TechStack }> {
  return dirs.map((dir) => ({
    dir,
    tech: new TechDetector({ cwd: resolve(this.cwd, dir) }).detect(),
  }));
}
```

The existing single-dir `detect()` stays completely unchanged and keeps being used standalone for the root/fallback case and by every caller that doesn't opt into multi-dir.

### 3.3 File → group assignment (new `src/stack-grouper.ts`, class `StackGrouper`)

Given `appDir` (string, array, or undefined), the repo root `cwd`, and the PR's changed files:

1. Normalize `appDir` to `string[]` (empty array if unset).
2. Run `TechDetector.detectAll()` on the configured dirs, and `TechDetector.detect()` once on `cwd` for the fallback/root stack.
3. For each changed file, pick the configured dir whose path is the **longest matching prefix** of the file's path (so `apps/web/lib` wins over `apps/web` if both are configured); files matching no configured dir go to the fallback group (`dir: '.'`, the root-detected stack).
4. If the number of distinct non-empty groups exceeds `config.maxStackGroups`, keep the largest groups (by file count) up to the limit and reassign the rest into the fallback group; log which directories were degraded and why (`console.log` — consistent with existing `chalk.dim`/`chalk.yellow` logging style in `reviewer.ts`).
5. Return `StackGroup[]`: `{ dir: string; tech: TechStack; appCwd: string; files: ChangedFile[] }[]`, dropping any group with zero files.

`StackGroup` is a new exported interface in `src/types.ts` (shared type, per CLAUDE.md's "types.ts: all shared types" convention).

### 3.4 Orchestration (`src/reviewer.ts`)

The current body of `reviewPullRequest` between "detect tech" and "call LLM" (dependency graph build → `loadFileContentBudgeted` → `callLLM`) is extracted into a private async function taking a single typed-object parameter (per CLAUDE.md — every existing module-scope helper in this file already follows this, e.g. `runIncrementalReview(args: {...})` at reviewer.ts:132, `callLLM(args: {...})` at reviewer.ts:717):

```ts
interface ReviewStackGroupArgs {
  group: StackGroup;
  ctx: PullRequestContext;
  config: ReviewerConfig;
  mergedRulesText: string;
  resolvedModel: string;
  projectDigest?: string;
  formatter: OutputFormatter;
}

async function reviewStackGroup(args: ReviewStackGroupArgs): Promise<ReviewResult> { ... }
```

It is unchanged in *content* — only its `tech`/`appCwd`/`files` inputs now come from `args.group` instead of the single PR-wide values.

`reviewPullRequest`:
1. Fetch + filter changed files (unchanged).
2. `new StackGrouper().group({ appDir: config.appDir, cwd, files: filtered, maxStackGroups: config.maxStackGroups })` → `StackGroup[]`.
3. For each group, sequentially: log `"Grupo <dir> (<tech>): N archivo(s)"`, call `reviewStackGroup(...)`.
4. `mergeReviewResults(results: ReviewResult[]): ReviewResult` (new pure function, `src/reviewer.ts`):
   - `recommendation`: worst wins — `request_changes` > `comment` > `approve`.
   - `overallScore`: `Math.min(...)` across groups that reported a score (`undefined` if none did).
   - `summary`: each group's summary prefixed with a `### <dir> (<TechDetector.displayName(tech)>)` heading when there is more than one group; the raw summary unprefixed when there is exactly one group (preserves today's output for single-stack repos).
   - `findings` / `anticipatedBugs` / `regressionRisks`: concatenated (file paths are already repo-root-relative from the GitHub API, so no path rewriting is needed).
   - `tokensUsed`: summed per field.
5. The merged `ReviewResult` flows into the exact same downstream code that exists today (`filterSuppressedFindings`, `decideReviewEvent`, `githubClient.postReview`, exit-code logic) — **unchanged**.

`runIncrementalReview` gets the same treatment: the incremental `filtered` file list is grouped with `StackGrouper` the same way, and the current single `promptBuilder.buildIncrementalSystemPrompt`/`buildIncrementalUserPrompt`/LLM-call block becomes a per-group loop merged with `mergeReviewResults`, reusing `priorFindings` filtered to each group's files.

### 3.5 Dependency graph per group

`DependencyGraphIndexer` is built once per group inside `reviewStackGroup`, using that group's `appCwd` (`resolve(cwd, group.dir)`) instead of the PR-wide `appCwd`. Fallback-group (`dir: '.'`) behaves exactly as today (`appCwd === cwd`).

### 3.6 Cached project-context comment (`src/project-context.ts`, `src/types.ts`)

`ProjectContext` gains an optional field:

```ts
stackMap?: ReadonlyArray<{ dir: string; tech: TechStack }>;
```

`appDir: string | undefined` stays as-is for backward compatibility with caches written by older reviewer versions (that field is otherwise unused once `stackMap` is present). `ProjectContextStore.serialize`/`deserialize` are extended to write/validate `stackMap` (array of `{dir: string, tech: one of VALID_TECH_STACKS}` — reuse the existing `VALID_TECH_STACKS` set).

`shouldInvalidate` gains a second condition beyond the existing version check: the cached `stackMap`'s directory list must be **set-equal** to the currently configured `appDir` list (normalized to an array) — same set of directories regardless of order, so reordering `appDir` entries in the config does not needlessly invalidate the cache, but adding, removing, or renaming a directory does. Reviewer.ts is the caller that has both the cached context and the live config, so this comparison lives there (mirrors how `shouldInvalidate` is already called from `reviewer.ts`), not inside `ProjectContextStore`.

### 3.7 Cost guard: `maxStackGroups`

Default `4`. Rationale: bounds worst-case LLM calls per PR to a small, predictable number even on a repo with many subprojects, while covering the realistic case (a web app + a shared package + a backend + maybe one more). Configurable per repo via `.ai-review.yml` for teams that genuinely need more.

## 4. Files to create or modify

| Path | Action | Purpose |
|---|---|---|
| `src/types.ts` | MODIFY | `appDir: string \| ReadonlyArray<string>`, `maxStackGroups: number`, new `StackGroup` interface, `ProjectContext.stackMap`. |
| `src/tech-detect.ts` | MODIFY | Add `detectAll()`. |
| `src/stack-grouper.ts` | NEW | `StackGrouper` class: normalizes `appDir`, assigns files to groups, enforces `maxStackGroups`. |
| `src/config.ts` | MODIFY | Default `maxStackGroups: 4` in `DEFAULT_CONFIG`. |
| `src/project-context.ts` | MODIFY | Serialize/validate `stackMap`. |
| `src/reviewer.ts` | MODIFY | Extract `reviewStackGroup()`, add `mergeReviewResults()`, wire `StackGrouper` into `reviewPullRequest` and `runIncrementalReview`, per-group `DependencyGraphIndexer` cwd, cache-invalidation-by-dir-list check. |
| `src/cli.ts` | MODIFY | `EXAMPLE_CONFIG` documents `appDir: [...]` and `maxStackGroups`. |
| `__test__/stack-grouper.test.ts` | NEW | Longest-prefix assignment, fallback group, `maxStackGroups` degradation. |
| `__test__/tech-detect.test.ts` | MODIFY | `detectAll()` cases. |
| `__test__/project-context.test.ts` | MODIFY | `stackMap` serialize/deserialize/validate round-trip. |
| `__test__/merge-review-results.test.ts` | NEW | Worst-wins recommendation, min-score, concatenation, per-group summary prefixing. |

## 5. Acceptance criteria

- [ ] A PR touching only `apps/web/**` (Flutter) behaves exactly as today: one group, unprefixed summary, single LLM call.
- [ ] A PR touching both `apps/web/**` (Flutter) and `apps/api/**` (NestJS), with `appDir: [apps/web, apps/api]` configured, produces findings for the NestJS files using NestJS rules and findings for the Flutter files using Flutter rules — verified by asserting the system prompt built for each group contains that group's template, not the other's.
- [ ] A changed file outside every configured `appDir` (e.g. `README.md`) is reviewed under the root-detected stack, not dropped.
- [ ] If a major/critical finding comes from any group, the merged `recommendation` is `request_changes`, even if every other group returned `approve` (consistent with the existing forced-block rule in `decideReviewEvent`).
- [ ] A repo with more distinct subproject directories than `maxStackGroups` still completes with exactly `maxStackGroups` LLM calls, and the console log states which directories were folded into the fallback group.
- [ ] Existing single-string `appDir: apps/web` configs keep working with zero behavior change (one group).
- [ ] The cached project-context comment round-trips a `stackMap` with 2+ entries; adding a new entry to `appDir` in config invalidates the cache and forces re-detection.

### Verification commands

```bash
npm run build
npx vitest run
```

## 6. Edge cases

- **Overlapping configured dirs** (`apps/web` and `apps/web/lib` both listed): longest-prefix match wins — files under `apps/web/lib` go to the `apps/web/lib` group, everything else under `apps/web` to the `apps/web` group.
- **Empty group**: a configured `appDir` entry with zero changed files under it is silently dropped — no empty LLM call.
- **All files in the fallback group** (no configured `appDir` matches anything changed): behaves exactly like today's single-group review.
- **`appDir` configured but directory doesn't exist on disk**: `TechDetector.detectAll()` returns `generic` for it (existing `detect()` behavior when `pubspec.yaml`/`composer.json`/`package.json` aren't found — no new error path needed).
- **One group's LLM call fails**: propagates as today (no partial-result swallowing) — a failure in any group fails the whole `review-pr` command, same as a single-group failure does today.
- **`maxStackGroups: 1`**: forces everything into the largest group + fallback merge — a legitimate way to opt back into single-pass behavior without removing the `appDir` array.

## 7. Decisions locked for this phase

| Decision | Why |
|---|---|
| Sequential per-group LLM calls, not parallel | Simpler logs (`Grupo X: ...` in order), avoids bursty rate-limit errors against a single API key; latency cost is acceptable given `maxStackGroups` bounds the worst case. |
| Worst-recommendation-wins / min-score-wins merge | Consistent with the already-shipped rule that any major/critical finding forces `REQUEST_CHANGES` regardless of score — a bad group must not be diluted by a good one. |
| Longest-prefix directory match, not glob patterns | Matches how monorepo tooling (Nx, Turborepo, Melos) already partitions by directory; avoids introducing a second pattern-matching syntax alongside the existing `ignore` globs. |
| `stackMap` cache invalidates on `appDir` list change | Detection is filesystem-cheap (no LLM call) — correctness (never stale-serve a stack from a removed/renamed subproject) is worth the small extra `TechDetector` cost on the first push after a config change. |
| Incremental review uses the same grouping as full review | One code path (`StackGrouper` + `reviewStackGroup` + `mergeReviewResults`) for both, instead of two divergent implementations that could drift. |

## 8. Restrictions

The implementer must NOT:

- [ ] Change `TechStack`, `Severity`, or `CheckCategory` enums as part of this work.
- [ ] Add a new LLM provider or touch `src/llm/*` adapters beyond what's already required by existing call sites.
- [ ] Introduce glob-pattern matching for `appDir` (directory-prefix only, per Decisions above).
- [ ] Refactor `PromptBuilder` or `GitHubClient` beyond what's needed to accept per-group inputs they already accept per-call (`tech`, `files`, `dependencyIndex`).
- [ ] Remove or rename the existing single-string `appDir` behavior — it must remain a valid, fully-supported input shape.

## 9. Testing

Per CLAUDE.md: Vitest, `__test__/` at root mirroring `src/`, mandatory AAA blocks, one class per file (`<~100` lines per file — split `merge-review-results.test.ts` from `reviewer.test.ts` if needed, same pattern already used for `decide-review-event.test.ts`), minimal mocks only at real boundaries (LLM/network/disk).

Priority units:
- `StackGrouper`: longest-prefix assignment, fallback group for unmatched files, `maxStackGroups` degradation (which groups get folded, in what order).
- `TechDetector.detectAll()`: multiple dirs, one missing on disk, one non-JS (`pubspec.yaml`) and one JS (`package.json`) in the same call.
- `mergeReviewResults()`: worst-recommendation-wins across 2 and 3 groups, min-score with one group having no score, summary prefixing (single group = unprefixed, multi-group = prefixed per dir).
- `ProjectContextStore`: `stackMap` round-trip, rejection of a malformed `stackMap` entry (missing `tech`, invalid `tech` value).
- `reviewer.ts` cache-invalidation-by-dir-list check (unit-level, not a full `reviewPullRequest` integration test — mirror the mocking style already used in `__test__/incremental-reviewer.test.ts`).

## 10. TypeScript Constraints (mandatory)

All code follows the CLAUDE.md standards without exception: no `any`/`unknown`; all logic in classes (`StackGrouper` is a class; `mergeReviewResults`/`reviewStackGroup` stay as module-scope functions in `reviewer.ts` only because that file's existing convention already uses module-scope helper functions alongside the CLI entry points — do not introduce a new class purely to satisfy the "no standalone functions" rule where the surrounding file doesn't already follow it); single typed-object parameters; explicit method return types; `readonly` for immutable data (`ReadonlyArray<string>` for `appDir`, `StackGroup.files`); `enum`/union types for closed sets; ESM `.js` import extensions; constructor dependency injection where a class is introduced. User-facing CLI strings stay in Spanish (rioplatense).

## 11. Open questions

- None outstanding — all design decisions were resolved with the user during spec authoring (see §7).
