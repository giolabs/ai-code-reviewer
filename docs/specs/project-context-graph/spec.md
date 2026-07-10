# Project Context Graph

> **Status:** PENDING PROPOSAL/CHANGE — no OpenSpec change has been generated yet. Run `/openspec-propose` (or `/opsx:propose`) using this spec as input.

## 1. Goal

On the first full review of a PR, the reviewer detects the tech stack, stores it in a hidden project-context comment on the PR, and reuses that cached context on every subsequent review of the same PR — full or incremental. This eliminates the "Stack detectado: Generic" failure in monorepos where `package.json` lives in a subdirectory and avoids repeating TechDetector overhead on every synchronize push.

If `config.tech` is explicitly set in `.ai-review.yml`, the graph is ignored: explicit config always wins.

---

## 2. Scope

### Included in this phase

- A new `ProjectContextStore` class (`src/project-context.ts`) with `serialize()` and `deserialize()` methods for the hidden comment format
- A `ProjectContext` interface in `src/types.ts` with fields: `tech`, `appDir`, `reviewerVersion`, `detectedAt`
- Two new `GitHubClient` methods: `findContextComment()` and `createContextComment()`
- Read path in `reviewPullRequest()`: before calling `TechDetector`, check for an existing context comment; if found and valid (same reviewer version), use its `tech` value
- Write path in `reviewPullRequest()`: after `postReview()` on the first full review (when no context comment existed at the start), create the context comment
- Console log lines for cache hit and cache write events
- Unit tests for `ProjectContextStore`, `findContextComment`, `createContextComment`, and the read/write flow in `reviewPullRequest()`

### Out of scope

- Sharing context across PRs (scope is per-PR — the comment lives on the PR)
- Storing anything beyond the four fields in `ProjectContext`
- Auto-inferring `appDir` from the detected context (this spec stores the appDir from `config.appDir`, not an inferred one — auto-inference of appDir for monorepos is a separate feature)
- Updating the context comment on subsequent reviews (write-once per PR)
- Using the context graph in `reviewSingleFile` or `reviewLocalDiff` commands
- Invalidating the cache when `.ai-review.yml` changes mid-PR
- Changing `TechDetector.detect()` — it is called as-is when no cached context exists
- Modifying the workflow YAML or example configs
- Cross-PR learning, repository-level persistence, or external storage

---

## 3. Technologies & Conventions

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js `>=18.0.0`
- **Package manager**: npm
- **Build**: `tsc` → `dist/`
- **Test**: Vitest (`npm test` → `vitest run`)
- **GitHub API (REST)**: `@octokit/rest ^21.0.0` — `issues.listComments` + `issues.createComment`
- **No new dependencies**

### Relevant versions (from `package.json`)

| Field | Value |
|---|---|
| `version` | `0.1.0-beta.7` |
| `node` engine | `>=18.0.0` |
| `typescript` | `^5.6.0` |
| `vitest` | `^3.2.6` |
| `@octokit/rest` | `^21.0.0` |

### Existing patterns to follow

- `src/github.ts` — `findBotSummaryCommentId()` (line 440) is the direct template for `findContextComment()`: same `issues.listComments` call, same loop pattern, same 0-as-not-found convention; `editComment()` pattern for `createContextComment()`
- `src/types.ts` — `FindingMetadata` interface is the template for `ProjectContext`; `PushEventShas` is the template for a lean interface with only primitive fields
- `src/reviewer.ts` — `resolveConfig()` (around line 52) is where the read-side fits; the write-side goes just after `postReview()` in `reviewPullRequest()`
- `src/feedback-handler.ts` — `extractCodeContextFromBody()` (line 153) is the template for HTML-comment extraction in `ProjectContextStore.deserialize()`
- `__test__/github.test.ts` — existing `GitHubClient` test blocks are the pattern for `findContextComment` and `createContextComment` tests

---

## 4. Prerequisites

- [x] `GitHubClient` class exists in `src/github.ts` with `octokit` as `private readonly`
- [x] `issues.listComments` is already used in `findBotSummaryCommentId()` (line 440)
- [x] `TechDetector` exists in `src/tech-detect.ts` and is instantiated in `reviewer.ts` (line 65)
- [x] `config.tech` optional override exists in `ReviewerConfig` (`src/types.ts:51`)
- [x] `config.appDir` optional override exists in `ReviewerConfig` (`src/types.ts:78`)
- [x] `resolveConfig()` in `src/reviewer.ts` returns `{ tech, appCwd, config, ... }` — the read path inserts before line 65
- [x] `reviewPullRequest()` in `src/reviewer.ts` calls `postReview()` and receives the result
- [x] `PullRequestContext` carries `owner`, `repo`, `pullNumber` — needed by both GitHub methods
- [x] `chalk` is already a dependency (`^5.3.0`) — used for console output
- [ ] `ProjectContext` interface — **does not exist yet** (created in this spec)
- [ ] `ProjectContextStore` class — **does not exist yet** (created in this spec)
- [ ] `GitHubClient.findContextComment()` — **does not exist yet** (created in this spec)
- [ ] `GitHubClient.createContextComment()` — **does not exist yet** (created in this spec)

---

## 5. Architecture

**Pattern**: Read-aside cache embedded in an issue comment on the PR. No new CLI commands. No new config keys.

### Affected layers

| Layer | Changed | Description |
|---|---|---|
| `src/types.ts` | yes | Add `ProjectContext` interface |
| `src/project-context.ts` | yes | NEW: `ProjectContextStore` class with serialize/deserialize |
| `src/github.ts` | yes | Add `findContextComment()` and `createContextComment()` |
| `src/reviewer.ts` | yes | Add context read before TechDetector; add context write after first postReview |
| `src/tech-detect.ts` | no | Unchanged |
| `src/config.ts` | no | No new config keys |
| `src/cli.ts` | no | No changes |

### Expected flow — first PR review (no cached context)

1. `review-pr` fires → `reviewPullRequest()` starts
2. `resolveConfig()` runs — reads config, determines `appCwd`
3. **Read path**: `githubClient.findContextComment(owner, repo, pullNumber)` → returns `null` (no context exists)
4. Because `foundContext === null`: run `TechDetector({ cwd: appCwd }).detect()` as today
5. Review runs normally → `postReview()` is called and returns `reviewId`
6. **Write path**: `contextStore.serialize({ tech, appDir: config.appDir, reviewerVersion: REVIEWER_VERSION, detectedAt: new Date().toISOString() })` → `githubClient.createContextComment(owner, repo, pullNumber, serialized)`
7. Console: `chalk.dim('✓ Contexto del proyecto guardado (tech: ${tech}).')`

### Expected flow — subsequent reviews of the same PR (incremental or full)

1. `reviewPullRequest()` starts
2. `resolveConfig()` runs
3. **Read path**: `githubClient.findContextComment(owner, repo, pullNumber)` → returns `ProjectContext`
4. `contextStore.shouldInvalidate(foundContext)` checks if `foundContext.reviewerVersion !== REVIEWER_VERSION`
   - If invalid (version mismatch): proceed as "first review" (run detector, re-write context)
   - If valid AND `config.tech` is NOT set: use `foundContext.tech` — skip `TechDetector`
   - If `config.tech` IS set: ignore cache, use `config.tech` (explicit config always wins)
5. Log: `chalk.dim('✓ Tech stack leído del contexto del proyecto: ${foundContext.tech}.')`
6. Review runs with the cached tech stack

### Hidden comment format

The context comment is a regular PR issue comment (GitHub "PR comment", not a review). Its body:

```
_🤖 Contexto del proyecto — generado automáticamente._
<!-- ai-review-context:{"tech":"nextjs","appDir":"site","reviewerVersion":"0.1.0-beta.7","detectedAt":"2026-07-10T21:36:00.000Z"} -->
```

The visible line makes the comment identifiable and non-empty. The HTML comment carries the machine-readable payload. `deserialize()` extracts the JSON from the HTML comment.

### `REVIEWER_VERSION` constant

A module-level constant in `src/project-context.ts` that reads the version from the package manifest at build time. Pattern: `import { createRequire } from 'node:module'; const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };` — same ESM pattern already used in the project for reading `package.json`. `REVIEWER_VERSION = pkg.version`.

### Layout of new code

```
src/
  types.ts            ← add: ProjectContext interface
  project-context.ts  ← NEW: ProjectContextStore class + REVIEWER_VERSION constant
  github.ts           ← add: findContextComment(), createContextComment()
  reviewer.ts         ← add: read path before TechDetector; write path after postReview
__test__/
  project-context.test.ts  ← NEW: unit tests for ProjectContextStore
  github.test.ts           ← extend: tests for findContextComment, createContextComment
  reviewer.test.ts         ← extend: tests for context read/write in reviewPullRequest
```

---

## 6. Files to Create / Modify

| Path | Action | Purpose | Follow |
|---|---|---|---|
| `src/types.ts` | MODIFY | Add `ProjectContext` interface | Existing `PushEventShas` and `FindingMetadata` in same file |
| `src/project-context.ts` | NUEVO | `ProjectContextStore` class with serialize/deserialize + `REVIEWER_VERSION` | `src/feedback-handler.ts` (`extractCodeContextFromBody` pattern) |
| `src/github.ts` | MODIFY | Add `findContextComment()` and `createContextComment()` | `findBotSummaryCommentId()` at line 440 |
| `src/reviewer.ts` | MODIFY | Read context before TechDetector; write context after first postReview | Existing `resolveConfig()` and `reviewPullRequest()` in same file |
| `__test__/project-context.test.ts` | NUEVO | Unit tests for `ProjectContextStore` | `__test__/handle-feedback.test.ts` (mock-free class tests) |
| `__test__/github.test.ts` | MODIFY | Tests for `findContextComment` and `createContextComment` | Existing `describe('GitHubClient')` block |
| `__test__/reviewer.test.ts` | MODIFY | Tests for context read/write integration in `reviewPullRequest` | Existing `describe('reviewPullRequest')` in same file |

### Detail per file

#### `src/types.ts`

**Responsibility**: Define `ProjectContext` — the shape persisted in the hidden comment.

```typescript
export interface ProjectContext {
  /** Tech stack detected on first review */
  tech: TechStack;
  /** Value of config.appDir at detection time, or undefined if not set */
  appDir: string | undefined;
  /** Reviewer package version that wrote this context */
  reviewerVersion: string;
  /** ISO 8601 timestamp of detection */
  detectedAt: string;
}
```

**Do not mix in**: Any finding, config, or GitHub API types.

---

#### `src/project-context.ts`

**Responsibility**: Serialize/deserialize `ProjectContext` to/from the hidden comment body; version-based invalidation.

```typescript
const MARKER_START = '<!-- ai-review-context:';
const MARKER_END = ' -->';
const VISIBLE_LABEL = '_🤖 Contexto del proyecto — generado automáticamente._\n';

export { REVIEWER_VERSION }; // exported for testing
export class ProjectContextStore {
  serialize(context: ProjectContext): string {
    // returns VISIBLE_LABEL + MARKER_START + JSON.stringify(context) + MARKER_END
  }

  deserialize(body: string): ProjectContext | null {
    // finds MARKER_START ... MARKER_END; JSON.parses; validates required fields;
    // returns null on any parse/validation failure
  }

  shouldInvalidate(context: ProjectContext): boolean {
    // returns true if context.reviewerVersion !== REVIEWER_VERSION
  }
}
```

Validation in `deserialize()`: the parsed object must have `tech` (string matching a `TechStack` value), `appDir` (string or undefined), `reviewerVersion` (non-empty string), `detectedAt` (non-empty string). Anything else returns `null`.

**Do not mix in**: GitHub API calls, chalk output, config loading.

---

#### `src/github.ts`

**Responsibility**: Two new methods on `GitHubClient`:

1. **`findContextComment(args: ContextCommentArgs): Promise<string | null>`** where `interface ContextCommentArgs { owner: string; repo: string; pullNumber: number }` (follows CLAUDE.md — all params in a typed object)
   - Calls `this.octokit.issues.listComments({ owner, repo, issue_number: pullNumber, per_page: 100 })`
   - Iterates comments from last to first looking for one from `github-actions[bot]` whose body includes `'<!-- ai-review-context:'`
   - Returns the **full comment body** string of the first match, or `null` if not found
   - Returns `null` on any API error (same silent-error pattern as `findBotSummaryCommentId`)
   - Do NOT add pagination — treat a miss beyond 100 comments as a cache miss, consistent with the existing `findBotSummaryCommentId` pattern
   - Follow: `findBotSummaryCommentId()` at line 440 exactly

2. **`createContextComment(args: ContextCommentArgs & { body: string }): Promise<void>`** (reuses `ContextCommentArgs` from above, extends with `body`)
   - Calls `this.octokit.issues.createComment({ owner, repo, issue_number: pullNumber, body })`
   - Returns void; swallows errors with `console.warn` (non-critical path — failure to write the context must not fail the review)
   - Follow: similar to `postReply()` in same file

**Do not mix in**: Serialization/deserialization logic (that belongs in `ProjectContextStore`), changes to existing methods.

---

#### `src/reviewer.ts`

**Responsibility**: Wire the read and write paths into `reviewPullRequest()`.

**Imports to add**: `ProjectContextStore` from `./project-context.js`; `ProjectContext` from `./types.js`.

**Read path** — insert after `resolveConfig()` and before the existing `TechDetector` call:

```typescript
const contextStore = new ProjectContextStore();
let foundContextBody: string | null = null;
let resolvedTech: TechStack = tech; // tech is the existing variable from resolveConfig

if (!config.tech) {
  foundContextBody = await githubClient.findContextComment(ctx.owner, ctx.repo, ctx.pullNumber);
  if (foundContextBody !== null) {
    const cachedContext = contextStore.deserialize(foundContextBody);
    if (cachedContext !== null && !contextStore.shouldInvalidate(cachedContext)) {
      resolvedTech = cachedContext.tech as TechStack;
      console.log(chalk.dim(`✓ Tech stack leído del contexto del proyecto: ${resolvedTech}.`));
    } else {
      foundContextBody = null; // treat as cache miss — will re-detect and re-write
    }
  }
}
// replace the direct `tech` usage below with `resolvedTech`
```

**Write path** — insert after `postReview()` returns, only when `foundContextBody === null` (no context existed):

```typescript
// Note: version-mismatch sets foundContextBody = null, so this also runs on mismatch.
// The old context comment is NOT deleted — one orphan comment per version bump per PR is acceptable (see §11).
if (foundContextBody === null) {
  const contextToSave: ProjectContext = {
    tech: resolvedTech,
    appDir: config.appDir,
    reviewerVersion: REVIEWER_VERSION,
    detectedAt: new Date().toISOString(),
  };
  const serialized = contextStore.serialize(contextToSave);
  await githubClient.createContextComment(ctx.owner, ctx.repo, ctx.pullNumber, serialized);
  console.log(chalk.dim(`✓ Contexto del proyecto guardado (tech: ${resolvedTech}).`));
}
```

**Restriction**: The write path runs ONLY in the full review flow — not inside `runIncrementalReview()`. Incremental reviews read but never write the context.

**Do not mix in**: Changes to `reviewSingleFile`, `reviewLocalDiff`, or `resolveConfig()` itself.

---

## 7. API Contract

No new external API surface for CLI consumers. Internally uses two additional GitHub REST endpoints:

- `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` — already used in `findBotSummaryCommentId()`; `findContextComment()` uses the same call
- `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` — to create the context comment (`createContextComment()`)

No `api-contract.md` needed.

---

## 8. Success Criteria

- [ ] First full review with no cached context: creates a hidden context comment on the PR
- [ ] Second review of the same PR: reads context comment, skips `TechDetector`, uses cached tech
- [ ] `config.tech` explicitly set: context comment is never read or written (config wins)
- [ ] Reviewer version mismatch in cached context: re-runs `TechDetector` and overwrites the context comment
- [ ] `createContextComment()` failure does NOT fail the review (swallowed with `console.warn`)
- [ ] `findContextComment()` returning `null` (first review): full review proceeds normally
- [ ] Incremental re-review reads the context (same read path) but does NOT write a new one
- [ ] Console logs "Tech stack leído del contexto" on cache hit; "Contexto guardado" on cache write
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0

### Required tests

| Test file | Scenarios |
|---|---|
| `__test__/project-context.test.ts` | `serialize`: returns string with MARKER_START and JSON payload; includes visible label. `deserialize`: returns null on missing marker; returns null on invalid JSON; returns null when required fields absent; returns ProjectContext on valid input. `shouldInvalidate`: returns true when reviewerVersion differs; returns false when same. |
| `__test__/github.test.ts` | `findContextComment`: returns null when no comment has the marker; returns comment body when marker found; returns null on API error. `createContextComment`: calls issues.createComment with correct body; does not throw on API error. |
| `__test__/reviewer.test.ts` | should use cached tech when context comment exists and version matches; should run TechDetector when no context comment; should run TechDetector and re-write when context version mismatches; should NOT write context when config.tech is set; should write context comment after first full review. |

### Verification commands

```bash
npm run build    # must exit 0
npm test         # must exit 0
```

---

## 9. UX Criteria

Not applicable — CLI/CI tool with no web UI.

**Console output (new lines):**

Cache hit:
```
✓ Tech stack leído del contexto del proyecto: nextjs.
```

Cache write (after first review):
```
✓ Contexto del proyecto guardado (tech: nextjs).
```

Version mismatch (re-detection):
```
⚠ Versión del reviewer cambió — re-detectando stack del proyecto.
```

Write failure (non-blocking):
```
[warn] No se pudo guardar el contexto del proyecto: {error message}
```

---

## 10. Decisions Made (Locked)

| Decision | Why |
|---|---|
| Storage in a PR issue comment with hidden HTML | No extra permissions beyond `pull-requests: write`; no repo file writes; no GitHub Actions cache configuration needed; already proven by `FindingMetadata` pattern in inline comments. |
| Per-PR scope (not cross-PR) | Simplest storage model. A repo-level store would require a dedicated issue or file write, complicating permissions and making data stale across branches. Per-PR data is always fresh for that PR's context. |
| Write-once per PR (no updates on subsequent reviews) | The detected stack for a PR is stable. Updating on every review would add noise. If the stack genuinely changes, the reviewer version bump invalidates the cache. |
| Invalidate on reviewer version change | New versions of the reviewer may have improved TechDetector logic. A version bump is a signal to re-detect. |
| `config.tech` always wins over cache | Explicit user configuration must never be silently overridden. If the user sets `tech: nestjs`, that decision is authoritative regardless of what was auto-detected. |
| `createContextComment()` failure is non-blocking | Failing to write the cache must never fail a review. The worst case is re-running detection on the next push — exactly what happens today. |
| `REVIEWER_VERSION` read from `package.json` at module load | Avoids hardcoding the version string and keeps it in sync with npm releases automatically. |
| Read path only in full review + incremental; write path only in full review | Incremental reviews should not overwrite a context that was set by the full review. They consume it. |
| Visible label in the comment body | A blank issue comment is confusing to developers who see it in the PR timeline. The label makes it clear what the comment is without exposing machine-readable JSON. |

---

## 11. Edge Cases

### No context comment found (first review)

`findContextComment()` returns `null` → `TechDetector` runs as today → write path creates context comment. No behavior change for first reviews.

### Context comment found but JSON is malformed

`deserialize()` returns `null` → treated as cache miss → `TechDetector` runs → context comment is overwritten. Silent recovery.

### Reviewer version mismatch

`shouldInvalidate()` returns `true` → `TechDetector` runs → existing context comment is re-created with `createContextComment()`. The old comment remains (one orphan comment per version bump, per PR — acceptable).

### `createContextComment()` API error (rate limit, permissions)

Error is caught inside `createContextComment()`, logged with `console.warn`, and swallowed. The review result is unaffected.

### `findContextComment()` returns a comment from a previous bot account

If the comment was posted by a different GitHub account (not `github-actions[bot]`), it won't match — `findContextComment()` only matches comments from `github-actions[bot]`. Returns `null` → cache miss → detect fresh.

### `config.tech` is set in `.ai-review.yml`

The read path is skipped entirely: `if (!config.tech)` guard. The write path is also skipped (since we're using `config.tech`, not detected tech). No context comment created.

### PR has more than 100 comments

`listComments` uses `per_page: 100` — same as `findBotSummaryCommentId()`. If the context comment is beyond position 100 (very active PR), it won't be found. Treat as cache miss → re-detect → create a new context comment. Acceptable degradation.

### Incremental re-review runs before first full review

`findContextComment()` returns `null`. The incremental path reads `null`, proceeds without cached tech, and uses TechDetector. No write path in incremental — the context is written only by full reviews. Correct behavior.

### `new Date().toISOString()` in the write path

Per the workflow harness constraints, `new Date()` is blocked in workflow scripts but NOT in regular TypeScript source files. This restriction applies only to Workflow agent scripts. `new Date().toISOString()` is valid in `src/reviewer.ts`.

---

## 12. Required UI States

Not applicable — CLI/CI tool with no web UI.

---

## 13. Validations

No user-supplied form input. Guard clauses:

- `deserialize()`: returns `null` if marker is absent, JSON.parse throws, or required fields (`tech`, `reviewerVersion`, `detectedAt`) are missing or empty
- `tech` field validation in `deserialize()`: must be one of the known `TechStack` values (`'nestjs' | 'react' | 'nextjs' | 'typescript' | 'node' | 'flutter' | 'laravel' | 'generic'`) — defined in `src/types.ts:23-31`
- `findContextComment()`: returns `null` on any API error — no throw
- `createContextComment()`: swallows errors with `console.warn` — no throw

---

## 14. Security & Permissions

- No new GitHub permissions required: `pull-requests: write` (already granted) covers both `issues.listComments` (read) and `issues.createComment` (write)
- `ProjectContext` contains only: detected tech stack, `config.appDir` value, reviewer version, timestamp — none of these are sensitive
- The comment body is posted by `github-actions[bot]` and is visible to all PR collaborators — do not embed secrets, API keys, or file content
- `GITHUB_TOKEN` is never logged — existing behavior unchanged

---

## 15. Observability & Logging

**Log (new lines, rioplatense Spanish):**

| When | Output |
|---|---|
| Context found and valid | `chalk.dim('✓ Tech stack leído del contexto del proyecto: ${tech}.')` |
| Context written (first review) | `chalk.dim('✓ Contexto del proyecto guardado (tech: ${tech}).')` |
| Version mismatch → re-detect | `chalk.yellow('⚠ Versión del reviewer cambió — re-detectando stack del proyecto.')` |
| Write failure | `console.warn('[warn] No se pudo guardar el contexto del proyecto:', err.message)` |

**Never log:**
- The full comment body
- The raw JSON of `ProjectContext`
- `GITHUB_TOKEN` or any credential

**Mechanism**: `chalk` via `console.log()` — same as all existing output in `src/reviewer.ts`.

---

## 16. i18n / User-Facing Copy

All CLI output is rioplatense Spanish. The visible label in the PR comment is also in Spanish.

| Location | String |
|---|---|
| `src/reviewer.ts` | `'✓ Tech stack leído del contexto del proyecto: ${tech}.'` |
| `src/reviewer.ts` | `'✓ Contexto del proyecto guardado (tech: ${tech}).'` |
| `src/reviewer.ts` | `'⚠ Versión del reviewer cambió — re-detectando stack del proyecto.'` |
| `src/reviewer.ts` | `'[warn] No se pudo guardar el contexto del proyecto:'` |
| `src/project-context.ts` | `'_🤖 Contexto del proyecto — generado automáticamente._'` (in VISIBLE_LABEL constant) |

---

## 17. Performance

- **Extra API calls per review run**: `findContextComment()` adds 1 `issues.listComments` call per `reviewPullRequest()` invocation. On the first review this is a miss. On subsequent reviews this is a hit and eliminates the `TechDetector` call (which may spawn `madge` in the dependency indexer path). Net: +1 lightweight API call, -1 file-system scan.
- **`createContextComment()` on first review**: 1 `issues.createComment` call. Adds ~200ms. Non-blocking even if slow.
- **`listComments` with `per_page: 100`**: returns up to 100 comments. Most PRs have far fewer. Single page, single call.
- **No caching between calls**: each `reviewPullRequest()` run fetches fresh (no in-memory state between workflow runs).

---

## 18. Restrictions

The implementer must NOT:

- [ ] Add any new npm dependencies
- [ ] Change `TechDetector.detect()` — invoke it as-is when cache is missing or invalid
- [ ] Write the context in the incremental re-review path (`runIncrementalReview`) — read only
- [ ] Add new config keys to `ReviewerConfig` or `.ai-review.yml`
- [ ] Embed sensitive data (secrets, file content, full diffs) in the context comment
- [ ] Throw from `createContextComment()` — the failure must be swallowed
- [ ] Change `postReview()`, `getPullRequestContextFromEnv()`, or `findBotSummaryCommentId()` signatures
- [ ] Export `foundContextBody` or `resolvedTech` beyond the `reviewPullRequest()` scope
- [ ] Use `Date.now()` or `Math.random()` in workflow scripts (restriction does NOT apply to regular TypeScript source files — `new Date().toISOString()` is valid in `src/reviewer.ts`)
- [ ] Modify `reviewSingleFile` or `reviewLocalDiff` — context graph is for `review-pr` only

---

## 19. Deliverables

- [ ] `src/types.ts` — `ProjectContext` interface added
- [ ] `src/project-context.ts` — NEW: `ProjectContextStore` class with `serialize()`, `deserialize()`, `shouldInvalidate()`; `REVIEWER_VERSION` constant exported
- [ ] `src/github.ts` — `findContextComment()` and `createContextComment()` added to `GitHubClient`
- [ ] `src/reviewer.ts` — read path and write path wired into `reviewPullRequest()`
- [ ] `__test__/project-context.test.ts` — NEW: 8+ unit tests for `ProjectContextStore`
- [ ] `__test__/github.test.ts` — 5 new tests for the two new `GitHubClient` methods
- [ ] `__test__/reviewer.test.ts` — 5 new tests for context read/write integration
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0

---

## 20. Final Agent Checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] `ProjectContext` is in `src/types.ts`, not in `src/project-context.ts`
- [ ] `ProjectContextStore` is a class with instance methods (not static) — follows CLAUDE.md class rules
- [ ] `REVIEWER_VERSION` reads from `package.json` at module load via `createRequire` (ESM pattern)
- [ ] `findContextComment()` returns `string | null` (the full body), not the comment ID
- [ ] `findContextComment()` returns `null` on API error — does not throw
- [ ] `createContextComment()` returns `void` — does not throw on error; logs with `console.warn`
- [ ] `deserialize()` validates the `tech` field against the known `TechStack` union values
- [ ] `deserialize()` returns `null` on any validation failure — never throws
- [ ] Read path is guarded by `if (!config.tech)` — explicit config skips the cache
- [ ] Write path is guarded by `foundContextBody === null` — only writes when no context existed
- [ ] Write path is NOT in `runIncrementalReview()` — incremental reads only
- [ ] Version mismatch re-runs detection AND creates a new context comment (re-write)
- [ ] `createContextComment()` failure does not fail the review
- [ ] All console output strings match §15 and §16 exactly
- [ ] No new npm dependencies added
- [ ] Modified only the files listed in §6
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] No temporary logs or debugging code left
- [ ] No unjustified TODOs
