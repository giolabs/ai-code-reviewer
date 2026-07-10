# Incremental Re-Review Mode

> **Status:** PENDING PROPOSAL/CHANGE — no OpenSpec change has been generated yet. Run `/openspec-propose` (or `/opsx:propose`) using this spec as input.

## 1. Goal

When the bot has already reviewed a PR at least once (detected by the presence of `<!-- ai-review-finding:... -->` metadata in any existing inline comment), subsequent `synchronize` pushes run an **incremental re-review** instead of repeating the full diff analysis that tools like CodeRabbit perform on every push:

1. Fetch only the diff introduced by the new push (`compare(before...after)`).
2. Send that diff — plus the list of prior open bot findings as context — to the LLM, asking whether the new changes introduce regressions or critical/major issues related to those findings.
3. Wire `ThreadResolver.resolveFixed()` to auto-close threads where the issue no longer appears in the new push's scope.
4. Post a new formal GitHub review only when the LLM finds regressions. If the incremental diff is empty or no regressions are found, skip silently.

First-time reviews (no prior bot findings) and non-`synchronize` events (`opened`, `review_requested`, `reopened`) continue to run the full review unchanged.

---

## 2. Scope

### Included in this phase

- Detect first vs. re-review by checking for `<!-- ai-review-finding:... -->` metadata in existing PR review comments
- Read `event.before` / `event.after` SHAs from the `synchronize` event payload via a new `getPushEventShasFromEnv()` helper
- Fetch the incremental diff using `GET /repos/{owner}/{repo}/compare/{before}...{after}` (new `GitHubClient.getCompareFiles()` method)
- New `PromptBuilder.buildIncrementalUserPrompt()` method that includes the new diff files + a prior-open-findings section
- New `PromptBuilder.buildIncrementalSystemPrompt()` method with regression-focused instructions (variant of the existing `buildSystemPrompt`)
- Wire `ThreadResolver.resolveFixed()` into the incremental path (it exists in `src/thread-resolver.ts` but is not yet called from `reviewPullRequest()`)
- New `GitHubClient.findBotSummaryCommentId()` method that scans PR issue comments for the bot's summary (`## 🤖 AI Code Review`) to supply `summaryCommentId` to `resolveFixed()`
- New console output lines distinguishing incremental mode from full review
- Unit tests for the new methods and the first-vs-re-review detection logic

### Out of scope

- Changing `reviewPullRequest()`'s behavior for `opened`, `review_requested`, or `reopened` events — those always run a full review
- Cross-PR learning (prior findings from other PRs are not used)
- Retroactive review of files not touched by the new push
- Modifying the PR description or GitHub Actions workflow YAML
- Deduplication between `synchronize` and other event types firing simultaneously
- Retroactively migrating or updating old `FindingMetadata` blobs in previously-posted comments
- Updating `.ai-review.yml` configuration schema (incremental mode is always on, no config flag)
- Re-reviewing files that are in the PR diff but not in the incremental push diff

---

## 3. Technologies & Conventions

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js `>=18.0.0`
- **Package manager**: npm
- **Build**: `tsc` → `dist/`
- **Test**: Vitest (`npm test` → `vitest run`)
- **GitHub API (REST)**: `@octokit/rest` — already a dependency; used for Compare endpoint
- **GitHub API (GraphQL)**: `@octokit/graphql` — already used in `resolveThread()`
- **No new dependencies required**

### Relevant versions (from `package.json`)

| Field | Value |
|---|---|
| `version` | `0.1.0-beta.6` |
| `node` engine | `>=18.0.0` |
| `typescript` | `^5.6.0` |
| `vitest` | `^3.2.6` |
| `@octokit/rest` | `^21.0.0` |

### Existing patterns to follow

- `src/reviewer.ts` — `reviewPullRequest()` is the orchestrator; add the first-vs-re-review branch inside it
- `src/github.ts` — `getPullRequestContextFromEnv()` (read-only function on env) and `GitHubClient` class (API methods); follow both patterns
- `src/thread-resolver.ts` — `ThreadResolver.resolveFixed()` already has the full contract; wire it, don't modify it
- `src/prompts.ts` — `PromptBuilder` class with `buildSystemPrompt()` / `buildUserPrompt()`; add incremental variants as new methods
- `src/types.ts` — all shared interfaces; add `PushEventShas` here

---

## 4. Prerequisites

- [x] `ThreadResolver.resolveFixed()` exists in `src/thread-resolver.ts` with full implementation
- [x] `GitHubClient.getPullRequestReviewComments()` exists in `src/github.ts` — used for detection
- [x] `GitHubClient.extractFindingMetadata()` exists in `src/github.ts`
- [x] `GitHubClient.postReview()` exists and accepts `event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'`
- [x] `PromptBuilder` exists in `src/prompts.ts` with `buildSystemPrompt()` and `buildUserPrompt()`
- [x] `ResolveFixedOptions` interface exists in `src/types.ts` — `summaryCommentId` field is already present and `ThreadResolver` already guards `=== 0`
- [x] `GITHUB_TOKEN` has `pull-requests: write` (required for resolve GraphQL mutation and postReview)
- [x] `synchronize` is already in the `pull_request.types` list in `examples/.github/workflows/ai-review.yml`
- [ ] `GitHubClient.getCompareFiles(owner, repo, base, head)` — **does not exist yet** (created in this spec)
- [ ] `GitHubClient.findBotSummaryCommentId(owner, repo, pullNumber)` — **does not exist yet** (created in this spec)
- [ ] `getPushEventShasFromEnv()` — **does not exist yet** (created in this spec)

---

## 5. Architecture

**Pattern**: Branch inside the existing `reviewPullRequest()` orchestrator. No new top-level entry point is added to the CLI.

### Affected layers

| Layer | Changed | Description |
|---|---|---|
| `src/reviewer.ts` | yes | Add incremental branch with first-vs-re-review detection and ThreadResolver wiring |
| `src/github.ts` | yes | Two new class methods (`getCompareFiles`, `findBotSummaryCommentId`) + one new standalone export (`getPushEventShasFromEnv`) |
| `src/prompts.ts` | yes | Two new methods on `PromptBuilder`: `buildIncrementalSystemPrompt`, `buildIncrementalUserPrompt` |
| `src/types.ts` | yes | New `PushEventShas` interface |
| `src/thread-resolver.ts` | no | Already implemented; only called from `reviewer.ts`, not modified |
| `src/cli.ts` | no | CLI commands unchanged; `review-pr` already calls `reviewPullRequest()` |
| `src/config.ts` | no | No new config keys |
| `examples/.github/workflows/ai-review.yml` | no | `synchronize` already listed; no change needed |

### Expected flow — incremental re-review

1. GitHub `synchronize` event fires → `review-pr` CLI command runs → `reviewPullRequest()` is called
2. `getPullRequestContextFromEnv()` reads PR context (unchanged)
3. `getPushEventShasFromEnv()` reads `event.before` + `event.after` SHAs from `GITHUB_EVENT_PATH`
   - If `event.action !== 'synchronize'` or SHAs are missing → fall through to full review
4. `githubClient.getPullRequestReviewComments()` fetches all review comments on the PR
5. Filter for any comment where `extractFindingMetadata(comment.body)` returns non-null and `status === 'open'`
   - If no prior bot findings → full review (unchanged path)
6. **Incremental path begins**:
   a. `getCompareFiles(owner, repo, before, after)` → `ChangedFile[]` for the new push
   b. If `changedFiles.length === 0` → skip LLM call; jump to step (e)
   c. Apply `ConfigLoader.filterIgnored()` + `maxFileSize` filter to incremental files
   d. Call LLM with `buildIncrementalSystemPrompt()` + `buildIncrementalUserPrompt(incrementalFiles, priorOpenFindings)`
   e. Call `ThreadResolver.resolveFixed()` with `{ newFindings, changedFiles, commitSha: ctx.headSha, summaryCommentId, owner, repo, pullNumber }`
      - `summaryCommentId` is found via `findBotSummaryCommentId()` (returns `0` if not found, `resolveFixed` already guards `=== 0`)
   f. If incremental LLM returned findings → `postReview()` with `event: mapRecommendationToEvent(result.recommendation)` — same logic as full review
   g. If no findings → skip posting (silent)
7. Console output distinguishes incremental from full review

### Expected flow — full review (unchanged)

Current `reviewPullRequest()` path, executed when:
- `event.action !== 'synchronize'`, OR
- No prior bot findings exist on the PR

### Layout of new code

No new files in `src/`. All changes are additions to existing files.

```
src/
  reviewer.ts        ← add: runIncrementalReview() private-scope helper + detection logic
  github.ts          ← add: 3 new methods on GitHubClient + 1 new standalone function
  prompts.ts         ← add: 2 new methods on PromptBuilder
  types.ts           ← add: PushEventShas interface
__test__/
  incremental-reviewer.test.ts   ← NEW test file
  github.test.ts                 ← extend with tests for 3 new GitHubClient methods
  prompts.test.ts                ← extend with tests for 2 new PromptBuilder methods
```

---

## 6. Files to Create / Modify

| Path | Action | Purpose | Follow |
|---|---|---|---|
| `src/reviewer.ts` | MODIFY | Add incremental branch + ThreadResolver wiring | Existing `reviewPullRequest()` in same file |
| `src/github.ts` | MODIFY | Add `getCompareFiles`, `findBotSummaryCommentId`, `getPushEventShasFromEnv` | Existing `GitHubClient` methods + `getPullRequestContextFromEnv()` |
| `src/prompts.ts` | MODIFY | Add `buildIncrementalSystemPrompt` + `buildIncrementalUserPrompt` | Existing `buildSystemPrompt` + `buildUserPrompt` in same file |
| `src/types.ts` | MODIFY | Add `PushEventShas` interface | Existing interface declarations in same file |
| `__test__/incremental-reviewer.test.ts` | NUEVO | Unit tests for first-vs-re-review detection and incremental orchestration | `__test__/handle-feedback.test.ts` (mocking pattern) |
| `__test__/github.test.ts` | MODIFY | Tests for `getCompareFiles`, `findBotSummaryCommentId`, `getPushEventShasFromEnv` | Existing `describe` blocks in same file |
| `__test__/prompts.test.ts` | MODIFY | Tests for incremental prompt methods | Existing `__test__/prompts.test.ts` (extend, do NOT replace) |

### Detail per file

#### `src/types.ts`

**Responsibility**: Define `PushEventShas` — the shape of `before`/`after` SHAs read from the `synchronize` event payload.

```typescript
export interface PushEventShas {
  before: string;
  after: string;
  action: string;
}
```

**Do not mix in**: Finding types, config types, or any GitHub API response shapes.

---

#### `src/github.ts`

**Responsibility**: Three new additions:

1. **`getPushEventShasFromEnv(): PushEventShas | null`** (standalone function, exported)
   - Reads `GITHUB_EVENT_PATH`, parses `event.action`, `event.before`, `event.after`
   - Returns `null` if env vars are missing, file not found, or JSON is malformed
   - Returns `null` if `action !== 'synchronize'` or `before`/`after` are empty strings
   - Follow: `getPullRequestContextFromEnv()` in same file (same null-safe pattern)

2. **`GitHubClient.getCompareFiles(owner: string, repo: string, base: string, head: string): Promise<ChangedFile[]>`**
   - Calls `GET /repos/{owner}/{repo}/compare/{base}...{head}` via `this.octokit.repos.compareCommitsWithBasehead`
   - Maps response `files` to `ChangedFile[]` with `path`, `status` (normalized via existing `normalizeStatus()`), `patch`, `additions`, `deletions`
   - Returns `[]` if response has no `files` field
   - Follow: `getPullRequestFiles()` in same file (same pagination-style mapping, but this endpoint returns all files at once — no pagination needed)

3. **`GitHubClient.findBotSummaryCommentId(owner: string, repo: string, pullNumber: number): Promise<number>`**
   - Calls `this.octokit.issues.listComments({ owner, repo, issue_number: pullNumber, per_page: 100 })` (PR comments are issue comments)
   - Iterates from last to first looking for a comment from `github-actions[bot]` whose body contains `## 🤖 AI Code Review`
   - Returns the comment `id` of the first match, or `0` if not found
   - Do NOT use `octokit.pulls.listReviewComments` — those are inline diff comments, not summary comments

**Do not mix in**: Any new types, changes to existing methods, changes to `extractFindingMetadata` or `embedFindingMetadata`.

---

#### `src/prompts.ts`

**Responsibility**: Two new methods on `PromptBuilder`:

1. **`buildIncrementalSystemPrompt(args: SystemPromptArgs): string`**
   - Same as `buildSystemPrompt()` but the opening instruction changes:
     - Instead of "Your goal is to review code changes with the rigor of an experienced reviewer", use: "You are performing an INCREMENTAL re-review. Your role is to check whether the new push introduces regressions or critical/major issues specifically in the context of the prior open findings listed in the user prompt. Do NOT report issues unrelated to the prior findings unless they are critical or major. Do NOT re-report prior findings — assume they are already tracked."
   - All other sections (stack, severity scale, rules, line referencing) remain identical
   - Follow: `buildSystemPrompt()` in same file

2. **`buildIncrementalUserPrompt(args: IncrementalUserPromptArgs): string`**
   - New interface: `IncrementalUserPromptArgs` with `files: ReadonlyArray<ChangedFile>`, `priorFindings: ReadonlyArray<{ file: string; line: number; severity: string; title: string; description: string }>`, `prTitle?: string`, `maxTotalChars?: number`
   - Builds a prompt with two sections:
     - Section A: Prior open findings (file:line — severity — title — description), formatted as a numbered list. Header: `**Prior open findings from previous review:**`
     - Section B: New push diff (same as `buildUserPrompt()` — file chunks with truncation). Header: `**New changes in this push (${files.length} files):**`
   - Closing instruction: `Review only the new changes. Flag regressions or new critical/major issues specifically related to the prior findings above. If the new changes partially or fully address a prior finding, do NOT re-flag it.`
   - Follow: `buildUserPrompt()` in same file

**Do not mix in**: Full-review prompt logic changes, new config options, or any GitHub API calls.

---

#### `src/reviewer.ts`

**Responsibility**: Add the incremental detection and orchestration branch.

New additions (private-scope helpers, not exported, following existing `resolveConfig`, `logHeader` style):

1. **`collectPriorOpenFindings(comments: ReadonlyArray<PrReviewComment>, githubClient: GitHubClient)`**: Filters comments for bot finding metadata with `status === 'open'`. For each, extracts the human-readable portion of the comment body (everything before `<!-- ai-review-finding:...-->`) plus the metadata fields. Returns an array of `{ file, line, severity, title, description }` where `description` is the stripped comment body text.

2. **`runIncrementalReview(ctx, config, opts, githubClient, priorOpenFindings, pushShas)`**: Orchestrates the incremental path:
   - Calls `getCompareFiles()`
   - Applies ignore + size filters
   - If filtered is empty → calls `ThreadResolver.resolveFixed()` then returns `null` (no findings, no post)
   - Calls LLM with `buildIncrementalSystemPrompt()` + `buildIncrementalUserPrompt()`
   - Calls `ThreadResolver.resolveFixed()`
   - If findings → calls `postReview()` → returns `ReviewPRResult`
   - If no findings → returns `null` (silent)

**Modified in `reviewPullRequest()`**: After step 3 (config resolution), add:
```
a. Call getPushEventShasFromEnv()
b. Call githubClient.getPullRequestReviewComments()
c. Call collectPriorOpenFindings()
d. If pushShas is non-null AND priorOpenFindings.length > 0:
   → runIncrementalReview() and return its result
e. Otherwise: continue with full review (existing code, unchanged)
```

**Do not mix in**: Changes to `reviewSingleFile`, `reviewLocalDiff`, or `callLLM`. Do not export `runIncrementalReview` or `collectPriorOpenFindings`.

---

## 7. API Contract

No new external API surface for CLI consumers. Internally, this feature uses two additional GitHub REST endpoints:

- `GET /repos/{owner}/{repo}/compare/{basehead}` — to fetch the incremental diff (`octokit.repos.compareCommitsWithBasehead`)
- `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` — to find the bot's summary comment (`octokit.issues.listComments`; already used indirectly in `ThreadResolver`)

Both are accessed via the existing `@octokit/rest` client. No `api-contract.md` needed.

---

## 8. Success Criteria

- [ ] A `synchronize` push on a PR with prior bot findings triggers incremental mode, not full review
- [ ] A `synchronize` push on a PR with **no** prior bot findings triggers full review (unchanged)
- [ ] An `opened` or `review_requested` event always triggers full review regardless of prior findings
- [ ] Incremental LLM prompt includes the list of prior open findings
- [ ] When the incremental diff is empty, no LLM call is made and nothing is posted
- [ ] `ThreadResolver.resolveFixed()` is called on every incremental re-review
- [ ] When regressions are found, a new formal GitHub review is posted
- [ ] When no regressions are found and diff is non-empty, nothing is posted
- [ ] Console output clearly states "Modo incremental" vs full review
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0

### Required tests

| Test file | Scenarios |
|---|---|
| `__test__/incremental-reviewer.test.ts` | should run full review when no prior bot findings exist; should run incremental review when prior open findings exist; should return null when incremental diff is empty; should call ThreadResolver.resolveFixed on incremental path; should NOT call ThreadResolver on full review path |
| `__test__/github.test.ts` (extended) | `getPushEventShasFromEnv`: returns null when action is not synchronize; returns null when before/after are missing; returns shas when synchronize payload is valid. `findBotSummaryCommentId`: returns 0 when no bot summary comment exists; returns comment id when found. `getCompareFiles`: returns empty array when no files in response; returns mapped ChangedFile[] for valid compare response |
| `__test__/prompts.test.ts` (new) | `buildIncrementalUserPrompt`: includes prior findings section; includes new diff section; truncates at maxTotalChars. `buildIncrementalSystemPrompt`: contains incremental-specific instruction; does not contain full-review opening |

### Verification commands

```bash
npm run build    # must exit 0
npm test         # must exit 0
```

---

## 9. UX Criteria

No web UI. Console output only.

**Full review (unchanged):**
```
Revisando PR #42: Fix auth bug
Stack detectado: TypeScript
...
```

**Incremental re-review activated:**
```
Revisando PR #42: Fix auth bug [modo incremental]
Stack detectado: TypeScript
Provider: openai · Modelo: gpt-4o · Idioma: es
Modo incremental: 3 archivos nuevos en este push · 5 findings abiertos del review anterior
Llamando a OpenAI...
✓ 2 thread(s) resuelto(s) automáticamente.
✓ Review incremental posteado en PR #42
```

**Incremental — diff vacío:**
```
Revisando PR #42: Fix auth bug [modo incremental]
Modo incremental: sin archivos nuevos en este push. Chequeando threads resueltos...
✓ 1 thread(s) resuelto(s) automáticamente.
```

**Incremental — no regressions, no resolve:**
```
Modo incremental: 2 archivos nuevos · sin regresiones detectadas.
```

---

## 10. Decisions Made (Locked)

| Decision | Why |
|---|---|
| Detect first-vs-re-review via presence of `<!-- ai-review-finding:... -->` metadata | No extra API call beyond what ThreadResolver already needs. Works regardless of bot account login name. |
| Incremental mode only on `synchronize` events | Only `synchronize` payloads contain `event.before` / `event.after` SHAs. Other events (`opened`, `review_requested`) don't have a sensible "incremental diff" — they represent the full PR state. |
| Post a new formal GitHub review on regressions | Consistent with the full-review behavior. Makes regressions visible as a distinct review entry in the PR's review history, not buried as orphan comments. |
| Skip silently when no regressions found (empty or no findings) | Avoid cluttering the PR with "LGTM" noise on every push. ThreadResolver still runs to close fixed threads — that feedback IS visible via thread resolution. |
| LLM receives new diff + prior open findings list | The LLM needs both: the new code (to assess regressions) and what prior issues were raised (to focus and avoid re-flagging). |
| `summaryCommentId` found by scanning issue comments for `## 🤖 AI Code Review` | Avoids storing state between runs (no persistence layer needed). `summaryCommentId = 0` is already guarded by `ThreadResolver` — if not found, resolution still succeeds but the summary comment isn't appended. |
| Incremental mode is always on — no config flag | Simplifies configuration. The behavior is strictly additive and doesn't break any current usage. |
| Do NOT call `resolveFixed()` on full review path | Prevents false resolution when the full diff is reviewed and a finding happens to match a prior finding ID by hash collision or file/line coincidence. |

---

## 11. Edge Cases

### `before` SHA unavailable or equals `after` (force-push)

On a force-push, `event.before` may point to a non-existent commit if history was rewritten. `getCompareFiles()` will receive a 404 from GitHub's Compare API. **Behavior**: catch the error, log a warning, fall through to full review.

### Prior bot review was dismissed or all findings were resolved

`getPullRequestReviewComments()` will find prior bot comments, but `collectPriorOpenFindings()` filters for `status === 'open'`. If all are resolved/dismissed, `priorOpenFindings.length === 0` → falls through to full review. This is correct — a clean PR gets a fresh full review on the next push.

### `findBotSummaryCommentId()` returns 0 (summary comment deleted)

`ThreadResolver.resolveFixed()` guards `summaryCommentId === 0` with `if (args.summaryCommentId === 0) return`. Thread resolution still proceeds; only the summary append is skipped.

### Incremental diff has 100+ files (large refactor in a single push)

Apply the same `ConfigLoader.filterIgnored()` + `maxFileSize` filters as the full review. If filtered result still exceeds the prompt size, truncation in `buildIncrementalUserPrompt()` applies (inherited from `buildUserPrompt()` logic). This is acceptable.

### `synchronize` and `review_requested` fire simultaneously

Two independent workflow runs — one runs incremental (synchronize), the other runs full (review_requested). Both post reviews. No conflict handling required; GitHub merges them in the review list.

### PR is closed or merged before incremental review finishes

`postReview()` returns 422. Existing error handling in `reviewPullRequest()` logs and exits 1. No change needed.

### Bot has multiple prior reviews, some with `dismissed` findings

`collectPriorOpenFindings()` only collects `status === 'open'`. Dismissed findings are silently excluded. This is correct — the developer explicitly dismissed them.

### API errors from GraphQL `resolveReviewThread` during `resolveFixed()`

Already handled by `ThreadResolver` — wraps each resolution in try/catch and logs the error. No change needed.

---

## 12. Required UI States

Not applicable — CLI/CI tool with no web UI.

---

## 13. Validations

No user-supplied form input. Guard clauses only:

- `getPushEventShasFromEnv()`: returns `null` if `action !== 'synchronize'` or `before`/`after` are empty strings
- `getCompareFiles()`: returns `[]` if API returns no `files` field; re-throws on non-404 errors after logging
- `collectPriorOpenFindings()`: returns `[]` if no comments pass the metadata filter

---

## 14. Security & Permissions

- No new GitHub permissions required beyond the existing `pull-requests: write` (which covers `resolveReviewThread` GraphQL mutation, `postReview()`, and `listComments()`)
- `event.before` / `event.after` are commit SHAs — not sensitive; safe to log
- `GITHUB_TOKEN` is never logged — existing behavior unchanged
- No new environment variables required

---

## 15. Observability & Logging

**Log (new lines, in rioplatense Spanish):**
- `"Modo incremental: {N} archivo(s) nuevos en este push · {M} finding(s) abiertos del review anterior"` — when incremental mode activates
- `"Modo incremental: sin archivos nuevos en este push. Chequeando threads resueltos..."` — when incremental diff is empty
- `"✓ {N} thread(s) resuelto(s) automáticamente."` — after `resolveFixed()` when count > 0
- `"⚠ No se pudo obtener el compare diff: {err.message}. Cayendo a full review."` — on Compare API error
- `"Modo incremental: sin regresiones detectadas."` — when LLM returns no findings

**Never log:**
- Full comment bodies (may contain code)
- Finding metadata JSON blobs
- Prior finding descriptions (may contain sensitive code context)

**Mechanism**: `chalk` via `console.log()` — same as all existing output in `src/reviewer.ts`.

---

## 16. i18n / User-Facing Copy

New strings are all in rioplatense Spanish (CLI output convention of this project). No translation system used — raw strings in `console.log()` calls.

| Location | String |
|---|---|
| `src/reviewer.ts` | `"Modo incremental: {N} archivo(s) nuevos en este push · {M} finding(s) abiertos del review anterior"` |
| `src/reviewer.ts` | `"Modo incremental: sin archivos nuevos en este push. Chequeando threads resueltos..."` |
| `src/reviewer.ts` | `"Modo incremental: sin regresiones detectadas."` |
| `src/reviewer.ts` | `"⚠ No se pudo obtener el compare diff: {msg}. Cayendo a full review."` |
| `src/reviewer.ts` | `"✓ {N} thread(s) resuelto(s) automáticamente."` |
| `src/reviewer.ts` | Title suffix `[modo incremental]` appended to the PR review line |
| `src/prompts.ts` | Section headers inside `buildIncrementalUserPrompt()` are in English (LLM prompt — language-model-facing, not user-facing) |

---

## 17. Performance

- **Extra API calls per `synchronize` event**: The detection check (`getPullRequestReviewComments()`) runs on every `synchronize` event before knowing whether incremental mode applies. On PRs with zero prior comments it returns immediately with an empty page. Incremental path adds: +1 `compareCommitsWithBasehead`, +1 `issues.listComments` (summary comment lookup). Acceptable — 3 total lightweight calls.
- **LLM token reduction**: Incremental path sends only the new push diff (typically much smaller than the full PR diff) + a compact prior-findings list. Expected to reduce per-review token cost significantly on active PRs.
- **`getPullRequestReviewComments()` call added to every `synchronize` event** (even on first-review detection before falling back to full): 1 paginated call. If the PR has 0 comments, returns immediately. Acceptable overhead.
- **No caching required**: The detection check is cheap; results are not reused across workflow runs.

---

## 18. Restrictions

The implementer must NOT:

- [ ] Change the behavior of `reviewPullRequest()` for `opened`, `review_requested`, or `reopened` events
- [ ] Call `ThreadResolver.resolveFixed()` in the full-review path
- [ ] Modify `ThreadResolver.resolveFixed()` or `ResolveFixedOptions` — the existing contract is correct as-is
- [ ] Add any new `npm` dependencies
- [ ] Add a config flag for incremental mode (it is unconditionally enabled)
- [ ] Export `runIncrementalReview` or `collectPriorOpenFindings` as public API
- [ ] Change `postReview()`, `getPullRequestContextFromEnv()`, `buildSystemPrompt()`, or `buildUserPrompt()` signatures — extend, don't modify
- [ ] Store any state between workflow runs (no file writes, no external storage)
- [ ] Refactor `callLLM()` — it is shared by all review paths; modifications risk breaking `reviewSingleFile` and `reviewLocalDiff`

---

## 19. Deliverables

- [ ] `src/types.ts` — `PushEventShas` interface added
- [ ] `src/github.ts` — `getPushEventShasFromEnv()`, `GitHubClient.getCompareFiles()`, `GitHubClient.findBotSummaryCommentId()` added
- [ ] `src/prompts.ts` — `buildIncrementalSystemPrompt()` and `buildIncrementalUserPrompt()` added to `PromptBuilder`
- [ ] `src/reviewer.ts` — incremental detection + orchestration branch wired into `reviewPullRequest()`
- [ ] `__test__/incremental-reviewer.test.ts` — 5+ new tests for orchestration
- [ ] `__test__/github.test.ts` — 7 new tests for the 3 new methods
- [ ] `__test__/prompts.test.ts` — 4+ new tests for incremental prompt methods
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0

---

## 20. Final Agent Checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] `src/types.ts` has `PushEventShas` interface
- [ ] `getPushEventShasFromEnv()` returns `null` for non-`synchronize` events and for missing SHAs
- [ ] `getCompareFiles()` returns `[]` (not throws) when the compare response has no files
- [ ] `findBotSummaryCommentId()` returns `0` (not throws) when no matching comment is found
- [ ] `buildIncrementalSystemPrompt()` contains the incremental-specific opening instruction
- [ ] `buildIncrementalUserPrompt()` has two distinct sections: prior findings + new diff
- [ ] `collectPriorOpenFindings()` only returns findings with `status === 'open'`
- [ ] `ThreadResolver.resolveFixed()` is called ONLY in the incremental path, never in the full-review path
- [ ] `runIncrementalReview()` falls back to full review (not throws) on Compare API errors
- [ ] When incremental diff is empty, LLM is NOT called
- [ ] When LLM finds no regressions, `postReview()` is NOT called
- [ ] All console output strings match §15 and §16 exactly
- [ ] No new `npm` dependencies added
- [ ] No changes to `postReview()`, `getPullRequestContextFromEnv()`, `buildSystemPrompt()`, or `buildUserPrompt()` signatures
- [ ] `ThreadResolver.resolveFixed()` is NOT modified
- [ ] Modified only the files listed in §6
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] No temporary logs or debugging code left
- [ ] No unjustified TODOs
