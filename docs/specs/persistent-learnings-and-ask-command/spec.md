# Persistent Cross-PR Learnings + `@botai ask`

> **Status:** DRAFT

## 1. Goal

Close two gaps identified by researching competing AI reviewers (CodeRabbit, Greptile, Qodo/PR-Agent) against this project's own architecture:

1. **No memory across PRs.** Today `suppressedFingerprints` (`src/project-context.ts`) and every `@botai dismiss` live inside the hidden `<!-- ai-review-context: -->` comment scoped to **one PR**. If a developer dismisses a false-positive pattern in PR #67, the exact same pattern is flagged fresh in PR #68 — the bot never generalizes from one correction to the next. CodeRabbit solves this with "Learnings": natural-language preferences captured from chat replies and applied to every future review, repo- or org-wide.
2. **No general-purpose Q&A.** `@botai explain` (`src/feedback-handler.ts`) only answers questions about one specific inline finding — it requires a parent comment with finding metadata. Qodo's `/ask` lets a developer ask anything about a PR without anchoring to one finding and without triggering a re-review.

This spec adds a repo-level, git-committed Learnings store (`@botai learn` + auto-capture from `@botai dismiss`) injected into every future system prompt, and a general-purpose `@botai ask` command usable both inline and from general PR comments.

A third, lower-priority idea from the research — Greptile's "swarm agents" (one parallel LLM call per review lens — security, performance, architecture — instead of per detected stack, mirroring the multi-stack pipeline shipped in `docs/specs/multi-stack-review-by-directory/spec.md`) — is specified at interface level in §11 as an explicit stretch goal, not required for this phase's acceptance criteria.

## 2. Scope

### Included in this phase

- `LearningsStore` (`src/learnings-store.ts`): reads/writes `.ai-review-learnings.md` at the repo root via the GitHub Contents API, committed directly to the default branch.
- `@botai learn """rule"""` command (general PR comment or inline) that appends an entry.
- `@botai dismiss` (existing, inline-only) additionally appends an auto-generated entry (fingerprint + reason if the dev supplied one) to the same store — **in addition to**, not instead of, the existing per-PR `suppressedFingerprints` mechanism, which is unchanged.
- Learnings content injected into every system prompt (full review + incremental) via the same `customInstructions` injection point `PromptBuilder` already uses (`src/prompts.ts:96-97`, `:250-251`).
- `learnings: { enabled: boolean; maxChars: number }` config (default `enabled: false` — opt-in, since it requires a new `contents: write` permission grant on the workflow; `maxChars: 4000`, mirrors `projectContext.maxChars` in `src/config.ts:159`).
- `@botai ask """question"""` command, inline and general-comment, answering freeform questions without triggering a re-review and without requiring finding metadata.
- New `EXAMPLE_CONFIG` documentation (`src/cli.ts`) and `examples/.github/workflows/ai-review.yml` guidance for the new `contents: write` permission.

### Out of scope (with rationale from the research)

- **Full semantic call-graph indexing of the entire repo** (Greptile-style). Contradicts this project's zero-backend, "runs entirely inside one CI job" design — `DependencyGraphIndexer` (`src/dependency-indexer.ts`, madge-based import graph) already covers the proportionate version of this for a tool with no persistent indexing infrastructure.
- **Autofix that commits a fix directly to the PR branch** (CodeRabbit-style). Contradicts the project's hard rule of never acting on a PR's own code without human approval (`decideReviewEvent` in `src/reviewer.ts:757-770` always forces `REQUEST_CHANGES` on major/critical, never auto-fixes). GitHub `\`\`\`suggestion` blocks (already emitted per `src/github.ts` `ensureFencedCodeBlock`/prompt instructions) are the safe existing equivalent — click-to-apply, human-triggered.
- **Cross-org learnings** (CodeRabbit supports org-wide scope in addition to repo-wide). This phase is repo-scoped only — `.ai-review-learnings.md` lives in the reviewed repo, not shared across repos.
- **Multi-lens review by category** (Greptile swarm agents) — designed at interface level only (§11), not implemented this phase.
- **`@botai forget`** (removing a specific learning entry) — the markdown-bullet format chosen (§6) has no stable per-entry ID to target; a human editing/removing a line directly in `.ai-review-learnings.md` is the escape hatch for this phase.

## 3. Feature A — Persistent Cross-PR Learnings

### 3.1 Problem

`ProjectContext.suppressedFingerprints` (`src/types.ts:380`) and its read/write methods (`GitHubClient.readSuppressedFingerprints`/`addSuppressedFingerprint`, `src/github.ts:652-682`) key off `findContextCommentMeta` (`src/github.ts:627`), which searches **that PR's own** issue comments for the `<!-- ai-review-context: -->` marker. There is no storage that outlives a single PR's lifecycle, and no way to capture a natural-language preference ("we always allow `console.log` in migration scripts") at all — only exact-fingerprint suppression of one specific finding.

### 3.2 Design

**Storage: `.ai-review-learnings.md` committed to the default branch.** A new class `LearningsStore` (`src/learnings-store.ts`) owns reading and appending entries:

```markdown
# AI Reviewer Learnings

_Auto-maintained by ai-code-reviewer. Edit or delete lines directly to remove a learning._

- No reportar `console.log` en scripts de migración bajo `scripts/migrations/**` (agregado por @lucasgio, PR #67, 2026-07-15)
- Dismissed: bug-risk finding matching "factory provider bootstrap timing" in NestJS modules (agregado por @lucasgio, PR #67, 2026-07-15)
```

One bullet per entry, oldest first, each ending with `(agregado por @<actor>, PR #<n>, <ISO date>)`. Plain markdown, no parseable frontmatter (per §10 decision) — the file's full text (bounded by `maxChars`) is injected into the system prompt verbatim, the same way `customInstructions` already is. No structured parsing is needed to *use* the file; a human can also hand-edit it directly (delete a line to retract a learning — this is the `@botai forget` escape hatch for this phase, per §2 out-of-scope).

**Read path.** `LearningsStore.read(args: { githubClient: GitHubClient; owner: string; repo: string; defaultBranch: string }): Promise<string>` fetches the file via `GitHubClient.getFileAtRef` (already exists, used by `feedback-handler.ts:142-147` for `@botai review`) against the default branch. Returns `''` when the file doesn't exist yet (first use) — never throws.

**Write path.** `LearningsStore.append(args: { githubClient: GitHubClient; owner: string; repo: string; defaultBranch: string; entry: string }): Promise<void>`:
1. Reads the current file + its blob `sha` via `octokit.repos.getContent` (new `GitHubClient.getFileWithSha` method — `getFileAtRef` returns content only, not the `sha` needed for an update).
2. Appends the new bullet (or creates the file with the header block above if it doesn't exist).
3. Truncates from the **oldest** entries (FIFO) if the result would exceed `config.learnings.maxChars`.
4. Commits via `octokit.repos.createOrUpdateFileContents({ owner, repo, path: '.ai-review-learnings.md', message, content: base64, sha, branch: defaultBranch })` — a direct commit to the default branch, not a PR. This is a deliberate exception to "the bot never acts without human approval": the commit only fires in response to an explicit human command (`@botai learn` or `@botai dismiss`), and the file is bot metadata, not product code.

**Default branch resolution.** `PullRequestContext` (`src/types.ts:322-334`) has `baseSha` but not the base branch **name**. Add `baseRefName: string` to `PullRequestContext`, populated in `getPullRequestContextFromEnv` (`src/github.ts:801-837`, from `pr.base.ref`) and `GitHubClient.getPullRequestContext` (`src/github.ts`, added in the `@botai review`-from-general-comment work, from `data.base.ref`). Note: this is the PR's **base** branch, not necessarily the repo's overall default branch (e.g. a PR against a `release/*` branch) — intentional: learnings commit to whatever branch the current PR targets, matching where the next PRs against that same base will actually be reviewed.

**Injection.** `resolveConfig` (`src/reviewer.ts:62`) already returns `buildRulesForTech`; add a sibling `learningsText: string` (empty string when `config.learnings?.enabled` is falsy) fetched once via `LearningsStore.read(...)` before the review loop, and merge it into `customInstructions` the same way `extraInstructions` already is (`src/reviewer.ts` — the merge added for the `@botai review`-from-general-comment feature): `config.customInstructions = [config.customInstructions, learningsText, opts.extraInstructions].filter(Boolean).join('\n\n')`.

**Auto-capture on dismiss.** `FeedbackHandler.handleDismiss` (`src/feedback-handler.ts:298-323`) gains a call to `LearningsStore.append` after the existing `addSuppressedFingerprint` call, with an entry built from `metadata.file` + the finding's title (extracted the same way `extractFindingTextFromBody` already does) + any reason text the developer wrote after `@botai dismiss` (extend `parseBotCommand`'s `dismiss` branch to also capture free text after the keyword, mirroring how `review`'s `"""..."""` capture already works, but without requiring triple-quotes — dismiss reasons are typically short prose, not code).

**New command: `@botai learn`.** `BotCommand` (`src/types.ts:206`) gains `'learn'`. `parseBotCommand` (`src/feedback-handler.ts:106`) recognizes `@botai learn """rule text"""` (reuses the existing `"""..."""` extraction pattern from `review`). Works both inline (`event.source === 'review_comment'`) and general (`'issue_comment'`) — unlike `dismiss`/`resolved`/`explain`, it needs no parent finding, so it's dispatched before the `inReplyToId === null` early-return in `FeedbackHandler.handle` (`src/feedback-handler.ts:64`), alongside `approved`. Posts a confirmation reply; does **not** trigger a re-review (`FeedbackHandleResult.triggerReview: false`).

### 3.3 Acceptance

- [ ] `@botai learn """No reportar console.log en scripts/migrations/**"""` posted on any PR appends a bullet to `.ai-review-learnings.md` on the PR's base branch, and a subsequent full or incremental review on a *different* PR against that same base branch includes the rule in its system prompt.
- [ ] `@botai dismiss` on an inline finding appends an auto-generated entry to the same file in addition to the existing per-PR fingerprint suppression (verified: `addSuppressedFingerprint` is still called, unchanged).
- [ ] `learnings.enabled: false` (default) — no `getFileWithSha`/`createOrUpdateFileContents` calls happen at all, and `@botai learn` replies that the feature is disabled instead of attempting a commit.
- [ ] Appending an entry that would push the file past `maxChars` drops the oldest bullet(s) first, keeps the header, and the file stays parseable.
- [ ] A repo with no `.ai-review-learnings.md` yet: `LearningsStore.read` returns `''` (no crash, no empty-file creation) until the first `@botai learn`/`dismiss`.

## 4. Feature B — `@botai ask`

### 4.1 Problem

`handleExplain` (`src/feedback-handler.ts:324-355`) requires `event.inReplyToId !== null` and fetched finding `metadata` — it can only ever answer "explain this one finding." There's no way to ask "why did you flag the whole `channels` module as risky?" or "what does this PR actually change in the API contract?" without it being tied to one specific finding thread.

### 4.2 Design

New `BotCommand` value `'ask'`. `parseBotCommand` captures free text the same way `review`/`learn` do: `@botai ask """question"""`.

**Inline** (`event.source === 'review_comment'`, replying to a finding thread): behaves like today's `explain` context-gathering (`getFileAtRef` + `extractLineWindow`, `src/feedback-handler.ts:331,337`) when `inReplyToId` is present, but — unlike `explain` — does **not** require finding metadata to exist on the parent; if `extractFindingMetadata` returns `null`, it still answers using just the file window around the comment's line, sourced from `GitHubClient.getReviewComment` (`src/github.ts`, already used) for the line number.

**General comment**: no file window — instead passes the PR's current AI Code Review summary (fetched via `findBotSummaryCommentId` + `getIssueComment`, both already added for `@botai review`-from-general-comment) and the PR title/body as context.

New `PromptBuilder.buildAskPrompt(args): string` (`src/prompts.ts`), distinct from `buildExplainPrompt` and `buildFeedbackEvaluationPrompt` — no `findingTitle`/`findingSeverity` params (there may be none), takes `question: string`, `contextKind: 'file-window' | 'pr-summary'`, and the corresponding context string.

**Never triggers a re-review** — `handleAsk` returns `{ triggerReview: false }` always; it posts a reply and stops, same shape as `explain`.

### 4.3 Acceptance

- [ ] `@botai ask """why is this flagged as major?"""` as a reply to an inline finding thread answers using the surrounding code, even for a comment where `extractFindingMetadata` returns `null` (e.g. a human's own comment, not a bot finding).
- [ ] `@botai ask """what does this PR change in the public API?"""` as a general PR comment answers using the PR's summary + title/body, without calling `reviewPullRequest` (verified: `FeedbackHandleResult.triggerReview` is `false`).
- [ ] `@botai ask` with no `"""..."""` text posts a reply asking the developer to include a question, instead of calling the LLM with an empty prompt.

## 5. Files to create or modify

| Path | Action | Purpose |
|---|---|---|
| `src/learnings-store.ts` | NEW | `LearningsStore` class: read/append `.ai-review-learnings.md` via the Contents API, FIFO truncation at `maxChars`. |
| `src/types.ts` | MODIFY | `BotCommand` gains `'learn' \| 'ask'`; `ReviewerConfig.learnings?: LearningsConfig`; new `LearningsConfig` interface; `PullRequestContext.baseRefName`. |
| `src/config.ts` | MODIFY | `DEFAULT_CONFIG` — no `learnings` key by default (feature opt-in, mirrors how `autoApprove`/`feedback` are `undefined` unless configured); parse `learnings.enabled`/`learnings.maxChars` in `loadConfig`. |
| `src/github.ts` | MODIFY | `getFileWithSha` (new — Contents API read with blob `sha`, needed for the update call); `createOrUpdateFile` (new — wraps `octokit.repos.createOrUpdateFileContents`); `getPullRequestContextFromEnv`/`getPullRequestContext` populate `baseRefName`. |
| `src/prompts.ts` | MODIFY | New `buildAskPrompt()`. |
| `src/feedback-handler.ts` | MODIFY | `parseBotCommand` recognizes `learn`/`ask`; new `handleLearn`, `handleAsk`; `handleDismiss` calls `LearningsStore.append`; `handle()` dispatches `learn`/`ask` before the inline-only gate. |
| `src/reviewer.ts` | MODIFY | `resolveConfig` fetches learnings text (when enabled) and merges into `customInstructions` alongside `extraInstructions`. |
| `src/cli.ts` | MODIFY | `EXAMPLE_CONFIG` documents `learnings: { enabled, maxChars }`. |
| `examples/.github/workflows/ai-review.yml` | MODIFY | Comment documenting the new `contents: write` permission requirement when `learnings.enabled: true`. |
| `docs/pages/handle-feedback.mdx` | MODIFY | Document `@botai learn` and `@botai ask`. |
| `docs/pages/configuration.mdx` | MODIFY | Document `learnings` config block. |
| `__test__/learnings-store.test.ts` | NEW | Read/append/truncation/first-use-empty-file behavior. |
| `__test__/feedback-handler-learn.test.ts` | NEW | `@botai learn`/auto-capture-on-dismiss dispatch cases (split out, see §12). |
| `__test__/feedback-handler-ask.test.ts` | NEW | `@botai ask` dispatch cases (split out, see §12). |
| `__test__/build-ask-prompt.test.ts` | NEW | `buildAskPrompt` scenarios (split out, see §12). |

### Detail per file

#### `src/learnings-store.ts`

- **Responsibility**: owns the on-disk format of `.ai-review-learnings.md` and the Contents-API read/write calls. Does not know about `@botai` commands or config resolution — those live in `feedback-handler.ts`/`reviewer.ts`.
- **Example to follow**: `src/project-context.ts` (`ProjectContextStore`) for the "serialize/deserialize a bot-maintained artifact" shape, though the storage medium differs (committed file vs. hidden PR comment).
- **Must not mix in**: `@botai` command parsing (stays in `feedback-handler.ts`), config defaults (stays in `config.ts`).

## 6. API Contract

No HTTP API surface — this is a CLI/GitHub Action tool. The "contract" is the GitHub REST Contents API (`GET /repos/{owner}/{repo}/contents/{path}`, `PUT /repos/{owner}/{repo}/contents/{path}`) consumed via `@octokit/rest`, already a project dependency. `Sin API surface — no aplica.` (no `api-contract.md` created for this spec.)

## 7. Success criteria

- [ ] All acceptance checkboxes in §3.3 and §4.3 pass.
- [ ] `learnings.enabled: false` (the default) produces byte-identical prompt behavior to before this spec — zero new API calls, zero new prompt sections.
- [ ] Existing `suppressedFingerprints`/`@botai dismiss` per-PR behavior is unchanged (regression check on `__test__/feedback-handler.test.ts` dismiss tests).

### Tests required

| Test file | Scenarios |
|---|---|
| `__test__/learnings-store.test.ts` | Append to empty/non-existent file creates header + first bullet; append to existing file preserves prior bullets; FIFO truncation drops oldest bullets first when over `maxChars`; read returns `''` on 404 without throwing. |
| `__test__/feedback-handler-learn.test.ts` | `@botai learn """text"""` (inline and general) appends and replies without triggering review; `@botai dismiss` still calls `addSuppressedFingerprint` AND now also `LearningsStore.append`. |
| `__test__/feedback-handler-ask.test.ts` | `@botai ask` inline without finding metadata still answers; `@botai ask` general uses PR summary context; `@botai ask` with empty `"""..."""` asks for a question instead of calling the LLM. |
| `__test__/build-ask-prompt.test.ts` | `buildAskPrompt` includes the question and the correct context kind (new file, not appended to `prompts.test.ts` — see §12). |

### Verification commands

```bash
npm run build
npx vitest run
```

## 8. Decisions locked for this phase

| Decision | Why |
|---|---|
| Committed markdown file, not a hidden pinned-issue comment | User's explicit choice — auditable in git history, human-editable/removable by deleting a line, no new "pinned issue" concept to introduce alongside the existing hidden-PR-comment pattern. |
| Direct commit to the PR's base branch, not a separate review PR | The triggering command (`@botai learn`/`dismiss`) is already an explicit human instruction; requiring a second PR-and-merge cycle for a one-line metadata addition would make the feature too high-friction to be used. |
| Both `dismiss` (auto) and `learn` (explicit) feed the store | A false-positive dismissed once should stop recurring without extra ceremony, but the team should also be able to declare a preventive rule before any finding exists. |
| Per-PR `suppressedFingerprints` unchanged, Learnings is additive | Fingerprint suppression is exact and free (no LLM call to apply); Learnings is fuzzy and costs prompt tokens on every review. Different tools for different precision/cost tradeoffs — don't collapse them into one mechanism. |
| Plain markdown bullets, no parseable per-entry structure | The only consumer of structure would be `@botai forget`, explicitly deferred (§2); until then, structure is pure overhead for a human who may also just open the file and delete a line. |
| `learnings.enabled` defaults to `false` | Requires a new `contents: write` permission grant on the workflow — must be an explicit opt-in, not a silent permission escalation for existing users who upgrade the package. |

## 9. Edge cases

- **Concurrent `@botai learn` on two PRs at once**: `createOrUpdateFileContents` requires the current blob `sha`; a stale `sha` (someone else committed first) returns `409 Conflict` from GitHub. `LearningsStore.append` catches this, re-fetches, re-applies the append, and retries once; on a second conflict it gives up and the bot replies that the learning couldn't be saved (asks the developer to retry).
- **`learnings.enabled: true` but the workflow lacks `contents: write`**: `createOrUpdateFileContents` returns `403`. Caught the same as any other GitHub API failure in this codebase (log + reply explaining the missing permission, don't crash the job).
- **`@botai learn` with empty `"""` text**: rejected before any API call — reply asking for a non-empty rule.
- **File exceeds `maxChars` on the very first entry** (a single rule longer than the configured limit): keep the header + that one entry regardless (never truncate below zero entries), log a warning that `maxChars` is too low for this content.
- **`@botai ask` inline on a thread with no `inReplyToId`** (shouldn't happen per GitHub's reply semantics, but defensively): falls back to the general-comment context path (PR summary) instead of erroring.

## 10. Restrictions

The implementer must NOT:

- [ ] Give the bot write access to files other than `.ai-review-learnings.md` as part of this spec.
- [ ] Remove or change the existing per-PR `suppressedFingerprints` mechanism.
- [ ] Make `learnings.enabled: true` the default.
- [ ] Implement `@botai forget` or any structured/parseable entry format (explicitly deferred, §2).
- [ ] Implement the multi-lens review from §11 — interfaces only, no `reviewPullRequest` wiring.
- [ ] Add a new LLM provider or touch `src/llm/*` adapters.

## 11. Stretch goal (design only, not implemented this phase) — Multi-lens review by category

Mirrors the multi-stack pipeline (`docs/specs/multi-stack-review-by-directory/spec.md` §3.4: `StackGrouper` → `reviewStackGroup` → `mergeReviewResults`) but groups by **enabled check category** instead of detected tech stack, inspired by Greptile v4's "swarm agents" (parallel security/performance/logic/style reviewers).

**Interface sketch** (not wired into `reviewPullRequest` this phase):

```ts
// ReviewerConfig
multiLensReview: boolean; // default false

// New: src/lens-grouper.ts
interface ReviewLens {
  category: CheckCategory;
}

class LensGrouper {
  // One "group" per enabled category in config.checks, each reviewing the SAME files
  // with a system prompt scoped to only that category's rules.
  group(config: ReviewerConfig): ReadonlyArray<ReviewLens>;
}
```

`reviewPullRequest` would, when `multiLensReview` is true, run one `callLLM`-equivalent pass per enabled category (each with `config.checks` narrowed to that single category) instead of one pass covering all categories, then feed the per-lens `ReviewResult[]` through the **same** `mergeReviewResults` already built for multi-stack — no new merge logic needed, just a new dimension to group by. Cost scales linearly with enabled category count (up to 8 today), so this must stay opt-in.

**Why deferred**: full acceptance criteria, cost-guard design (a `maxLenses` cap mirroring `maxStackGroups`), and interaction with multi-stack grouping (do lenses run per-stack-group, multiplying cost further, or only on the fallback/root group?) need their own clarification round — out of scope for the primary Learnings/`ask` work in this spec.

## 12. Testing

Per CLAUDE.md: Vitest, `__test__/` at root mirroring `src/`, mandatory AAA blocks, one class per test file (`<~100` lines), minimal mocks only at real boundaries (GitHub API, LLM).

`__test__/feedback-handler.test.ts` (459 lines) and `__test__/prompts.test.ts` (367 lines) are already well over the `~100` line budget from work that landed before this spec — not this spec's job to retroactively split, but it must not make it worse. The `learn`/`ask` cases go into the two new dedicated files listed in §5 (`feedback-handler-learn.test.ts`, `feedback-handler-ask.test.ts`), following the `decide-review-event.test.ts`/`merge-review-results.test.ts` split precedent from `docs/specs/multi-stack-review-by-directory/spec.md` — not appended to the existing oversized file. Likewise, `buildAskPrompt` tests go into a new `__test__/build-ask-prompt.test.ts`, not appended to `prompts.test.ts`.

## 13. TypeScript Constraints (mandatory)

All code follows the CLAUDE.md standards without exception: no `any`/`unknown`; all logic in classes (`LearningsStore` is a class; module-scope helper functions in `reviewer.ts`/`feedback-handler.ts` follow those files' existing established convention, per the precedent set in `docs/specs/multi-stack-review-by-directory/spec.md` §10); single typed-object parameters; explicit method return types; `readonly` for immutable data; `enum`/union types for closed sets (`BotCommand`); ESM `.js` import extensions; constructor dependency injection for classes. User-facing CLI/bot strings stay in Spanish (rioplatense) by default, following `config.language`.
