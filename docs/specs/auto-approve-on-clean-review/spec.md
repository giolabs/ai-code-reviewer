# Auto-Approve on Clean Review

> **Status:** DRAFT

## 1. Goal

When the AI model recommends `approve` and there are zero `critical` or `major` findings, the bot automatically posts a real GitHub `APPROVE` review event and dismisses any of its own previous `REQUEST_CHANGES` reviews on the same PR. This removes the manual step of dismissing the bot's own blocking review after a developer pushes a fix. A human approval is still required separately — the bot's approval counts as one of the required approvals, and the repository's branch protection rules enforce the rest.

## 2. Scope

### Included in this phase

- New `autoApprove` config block in `.ai-review.yml` (opt-in, disabled by default)
- New `AutoApproveConfig` interface in `src/types.ts`
- New `autoApprove?: AutoApproveConfig` field on `ReviewerConfig`
- Config parsing of `autoApprove` block in `src/config.ts`
- New `listPullRequestReviews()` method on `GitHubClient` — returns all reviews posted on a PR
- New `dismissReview()` method on `GitHubClient` — dismisses a single review by ID with a message
- Auto-approve logic in `reviewPullRequest()` in `src/reviewer.ts`:
  - Check `autoApprove.enabled` and conditions (recommendation + severity filter)
  - Fetch existing bot reviews, dismiss all pending `REQUEST_CHANGES` from the bot
  - Post `APPROVE` review event instead of `COMMENT`
- Console output indicating auto-approve was triggered (or why it was skipped)
- New test scenarios in `__test__/reviewer.test.ts` (or a new `__test__/auto-approve.test.ts`)

### Out of scope

- Auto-merge after approval (merge is always a human action)
- Dismissing or replacing human reviewer reviews
- Approving when any `critical` or `major` finding exists, regardless of overall score
- Approving when `recommendation` is `comment` (not `approve`) even if score is high
- Un-approving after a new push (GitHub handles this natively via "Dismiss stale reviews" branch protection)
- Notifying the developer via Slack or email
- GitHub Enterprise Server support
- Changing existing behavior when `autoApprove.enabled` is `false` or absent

## 3. Technologies & Conventions

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js `>=18.0.0`
- **Package manager**: npm
- **Build**: `tsc` → `dist/`
- **Test**: Vitest (`npm test` → `vitest run`)
- **GitHub API**: `@octokit/rest` — already a dependency; the reviews endpoints are part of the existing REST surface (`octokit.rest.pulls.listReviews`, `octokit.rest.pulls.dismissReview`)
- **No new dependencies required**

### Relevant versions (from `package.json`)

| Field | Value |
|---|---|
| `version` | `0.1.0-beta.3` |
| `node` engine | `>=18.0.0` |
| `typescript` | `^5.6.0` |
| `vitest` | `^3.2.6` |
| `@octokit/rest` | `^21.0.0` (already installed) |

### Existing patterns to follow

- `GitHubClient` class in `src/github.ts` — all new GitHub API methods go here, constructor-injected `Octokit` instance, single typed object parameter per method
- `ReviewerConfig` / `FeedbackConfig` in `src/types.ts` — new config block follows the same interface pattern
- `ConfigLoader.loadConfig()` in `src/config.ts` — follow how `feedback` block is parsed (YAML key → typed interface with defaults)
- Console output via `chalk` — use `chalk.green` for success, `chalk.yellow` for skipped/info, `chalk.dim` for details
- TypeScript coding standards from `CLAUDE.md`: no `any`/`unknown`, all params in typed objects, all logic in classes

## 4. Prerequisites

- [x] `GitHubClient` class exists in `src/github.ts` with constructor-injected `Octokit`
- [x] `postReview()` on `GitHubClient` accepts `event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'` (it already does)
- [x] `reviewPullRequest()` in `src/reviewer.ts` instantiates `GitHubClient` and calls `postReview()`
- [x] `ReviewerConfig` in `src/types.ts` has `feedback?: FeedbackConfig` as precedent for optional config blocks
- [x] `GITHUB_TOKEN` is available in the Actions environment (required for dismiss API call, which needs `pull-requests: write`)
- [x] `PullRequestContext` carries `owner`, `repo`, `pullNumber` (needed for list/dismiss API calls)

## 5. Architecture

**Pattern**: extend the existing pipeline in `reviewPullRequest()` with a post-review step.

**Affected layers**:

| Layer | Changed | Description |
|---|---|---|
| `src/types.ts` | yes | New `AutoApproveConfig` interface; extend `ReviewerConfig` |
| `src/config.ts` | yes | Parse `autoApprove` YAML block with defaults |
| `src/github.ts` | yes | `listPullRequestReviews()` + `dismissReview()` methods |
| `src/reviewer.ts` | yes | Post-review step: evaluate conditions, dismiss + approve |
| `src/cli.ts` | no | No change needed |
| `src/prompts.ts` | no | No change needed |

**Flow (when `autoApprove.enabled: true`):**

1. `reviewPullRequest()` runs the full review pipeline (same as today)
2. `result.recommendation` and `result.findings` are available
3. New function `shouldAutoApprove(result, config)` evaluates:
   - `config.autoApprove.enabled === true`
   - `result.recommendation === 'approve'`
   - No findings with `severity === 'critical'` or `severity === 'major'` after severity filtering
   - If `result.overallScore` is present: `result.overallScore >= config.autoApprove.minScore`
4. If `shouldAutoApprove` returns true:
   - `githubClient.listPullRequestReviews(ctx)` → fetch all reviews on the PR
   - Filter to reviews where `user.login === 'github-actions[bot]'` AND `state === 'CHANGES_REQUESTED'`
   - For each: `githubClient.dismissReview({ owner, repo, pullNumber, reviewId, message })`
   - Pass `event: 'APPROVE'` to `postReview()` instead of `'COMMENT'`
5. If `shouldAutoApprove` returns false:
   - Current behavior unchanged (`event: 'COMMENT'` or `'REQUEST_CHANGES'`)

**No new files created** — all changes go into existing files.

## 6. Files to Create / Modify

| Path | Action | Purpose | Follow |
|---|---|---|---|
| `src/types.ts` | MODIFY | Add `AutoApproveConfig` interface; add `autoApprove?` to `ReviewerConfig` | `FeedbackConfig` in same file |
| `src/config.ts` | MODIFY | Parse `autoApprove` block with defaults `{ enabled: false, minScore: 7 }` | `feedback` parsing in same file |
| `src/github.ts` | MODIFY | Add `listPullRequestReviews()` and `dismissReview()` to `GitHubClient` | Existing methods in same file |
| `src/reviewer.ts` | MODIFY | Add `shouldAutoApprove()` logic; pass correct `event` to `postReview()` | `mapRecommendationToEvent()` in same file |
| `__test__/reviewer.test.ts` | NEW | Test `shouldAutoApprove` conditions and integration with `postReview` event | `__test__/feedback-handler.test.ts` |

### Detail per file

**`src/types.ts`**
- Add `AutoApproveConfig` interface: `enabled: boolean`, `minScore: number`
- Add `autoApprove?: AutoApproveConfig` to `ReviewerConfig`
- Do NOT change `FeedbackConfig` or any other existing interface

**`src/config.ts`**
- In `loadConfig()` (or wherever `feedback` is parsed), add:
  ```
  autoApprove: {
    enabled: raw.autoApprove?.enabled ?? false,
    minScore: raw.autoApprove?.minScore ?? 7,
  }
  ```
- Default when block is absent: `{ enabled: false, minScore: 7 }`
- Do NOT change any other config key

**`src/github.ts`**
- `listPullRequestReviews(options: ListReviewsOptions): Promise<ReadonlyArray<PrReview>>`
  - `ListReviewsOptions`: `{ owner: string; repo: string; pullNumber: number }`
  - `PrReview`: `{ id: number; state: string; user: { login: string } }`
  - Uses `octokit.rest.pulls.listReviews`
- `dismissReview(options: DismissReviewOptions): Promise<void>`
  - `DismissReviewOptions`: `{ owner: string; repo: string; pullNumber: number; reviewId: number; message: string }`
  - Uses `octokit.rest.pulls.dismissReview`
  - Swallows 422 (already dismissed) silently; re-throws anything else
- Do NOT modify `postReview()`, `buildDiffLineMap()`, or any other existing method

**`src/reviewer.ts`**
- Replace `mapRecommendationToEvent()` call with new inline logic:
  - If `shouldAutoApprove(result, config)` → event = `'APPROVE'`, also call dismiss flow
  - Else if `result.recommendation === 'request_changes'` → event = `'REQUEST_CHANGES'`
  - Else → event = `'COMMENT'`
- `shouldAutoApprove(result: ReviewResult, config: ReviewerConfig): boolean` — pure module-scope function, no side effects, accepts the filtered findings (after `filterBySeverity`). Note: `reviewer.ts` already has module-scope helpers (`mapRecommendationToEvent`, `resolveConfig`, etc.) as a pre-existing pattern; this follows the same convention.
- Dismiss flow: wrapped in `try/catch`; a dismiss failure must never prevent the review from being posted
- Do NOT change `reviewSingleFile()`, `reviewLocalDiff()`, or any other export

**`__test__/reviewer.test.ts`**
- Test `shouldAutoApprove` in isolation (pure function, no mocks needed for the logic itself)
- Test that `postReview` is called with `event: 'APPROVE'` when conditions are met
- Test that `postReview` is called with `event: 'COMMENT'` when `autoApprove.enabled: false`
- Test that `postReview` is called with `event: 'COMMENT'` when a major finding exists even if recommendation = approve
- Test that dismiss is called for each `CHANGES_REQUESTED` bot review before posting APPROVE

## 7. API Contract

The feature uses two existing GitHub REST endpoints — no new external API surface is introduced. No `api-contract.md` is needed.

**`GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews`**
- Auth: `GITHUB_TOKEN` with `pull-requests: read`
- Response: array of review objects; we consume `id`, `state`, `user.login`

**`PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals`**
- Auth: `GITHUB_TOKEN` with `pull-requests: write` (already required by `review-pr`)
- Body: `{ message: string }`
- 200: dismissed; 422: already dismissed (silently ignored)

## 8. Success Criteria

- [ ] When `autoApprove.enabled: true`, model says `approve`, and zero critical/major findings: bot posts `APPROVE` event on GitHub
- [ ] When `autoApprove.enabled: true` and there is a previous `REQUEST_CHANGES` from `github-actions[bot]`: that review is dismissed before posting `APPROVE`
- [ ] When `autoApprove.enabled: true` but a `major` or `critical` finding exists: bot posts `COMMENT` (not `APPROVE`), no dismiss
- [ ] When `autoApprove.enabled: false` (default): behavior is identical to current (`COMMENT` or `REQUEST_CHANGES`)
- [ ] When `autoApprove.enabled: true` and `minScore: 8` but `overallScore: 6`: bot does NOT auto-approve
- [ ] Dismiss failure (422 or network error) does not prevent the `APPROVE` review from being posted
- [ ] `npm run build` passes with no TypeScript errors
- [ ] `npm test` passes (all existing tests + new scenarios)

### Required tests

**`__test__/reviewer.test.ts`** (new file):

| Test | Scenario |
|---|---|
| `should return true when all conditions are met` | recommendation=approve, no critical/major, enabled=true, score>=minScore |
| `should return false when enabled is false` | conditions met but autoApprove.enabled=false |
| `should return false when a major finding exists` | enabled=true, recommendation=approve, but 1 major finding |
| `should return false when a critical finding exists` | enabled=true, recommendation=approve, but 1 critical finding |
| `should return false when score is below minScore` | enabled=true, recommendation=approve, no blocking findings, overallScore=5, minScore=7 |
| `should return true when overallScore is absent` | enabled=true, recommendation=approve, no score field — absence does not block |
| `should call postReview with APPROVE event` | full mock integration: conditions met → APPROVE event passed |
| `should dismiss all CHANGES_REQUESTED bot reviews before approving` | 2 previous bot REQUEST_CHANGES → dismissReview called twice, then postReview with APPROVE |

### Verification commands

```bash
npm run build    # must exit 0
npm test         # must exit 0
```

## 9. UX Criteria

This feature has no web UI. All output is via the GitHub Actions log and GitHub PR review interface.

**Console output when auto-approving:**
```
✓ Auto-aprobando PR #42: recomendación approve, sin findings bloqueantes.
  Descartando review #1234567 (REQUEST_CHANGES) del bot...
  ✓ Review #1234567 descartado.
✓ Review posteado como APPROVE en PR #42
```

**Console output when conditions not met:**
```
ℹ Auto-approve desactivado o condiciones no cumplidas (recommendation: request_changes). Posteando COMMENT/REQUEST_CHANGES.
```

**On GitHub PR:**
- Previous bot `REQUEST_CHANGES` review shows "Dismissed"
- New bot review appears as "Approved" with the summary comment
- A separate human approval is still required to merge (assuming branch protection requires ≥2 approvals or specific required reviewers)

## 10. Decisions Made (Locked)

- **`minor`/`info`/`nitpick` do NOT block auto-approve.** Only `critical` and `major` are blocking. The model can still mention minor issues while the bot approves. Rationale: minor findings are advisory; they should not hold up a clean PR.
- **`overallScore` absence does not block.** If the model does not return a score, the score threshold is skipped. Rationale: not all prompts/models return scores; this must not be a hard dependency.
- **The bot dismisses only its own reviews.** `user.login === 'github-actions[bot]'` filter ensures human reviews are never touched. Rationale: the bot has no authority over human reviewers.
- **Disabled by default.** `autoApprove.enabled` defaults to `false`. Rationale: auto-approving is a significant action; teams must explicitly opt in.
- **Dismiss failure is non-fatal.** If `dismissReview` throws, the error is logged and the approve flow continues. Rationale: a review that can't be dismissed should not block the approval that unblocks the PR.
- **No "first review only" restriction.** Auto-approve triggers on any review (first or re-review) when conditions are met. If there are no previous `REQUEST_CHANGES` from the bot, the dismiss step is simply skipped. Rationale: a first review on a clean PR is a valid auto-approve scenario; restricting to re-reviews only adds complexity without clear benefit.

## 11. Edge Cases

| Case | Expected behavior |
|---|---|
| No previous bot review exists | Dismiss step skipped; APPROVE posted normally |
| Multiple previous REQUEST_CHANGES from bot | All are dismissed before APPROVE is posted |
| Previous APPROVE from bot already exists | No dismiss needed (state is not CHANGES_REQUESTED); APPROVE posted again (idempotent) |
| `dismissReview` returns 422 | Logged as warning, treated as already dismissed, flow continues |
| `dismissReview` returns 403 (no permission) | Logged as error, flow continues to post APPROVE anyway |
| `postReview` with APPROVE returns 422 | Logged as error; `process.exitCode` not set to 1 (approval failure ≠ code issue) |
| `minScore` present but `overallScore` absent | Score check skipped (absence treated as "no constraint") |
| `autoApprove.minScore: 0` | Score check always passes — effectively disabled |
| PR is already merged | GitHub returns 422 on dismiss/approve; caught and logged |
| `dry-run` mode | Auto-approve logic is evaluated but `postReview` and `dismissReview` are not called (same as today) |

## 12. Required UI States

Not applicable — this is a CLI/CI tool with no web UI.

## 13. Validations

| Field | Rule | Behavior if invalid |
|---|---|---|
| `autoApprove.enabled` | boolean | If non-boolean, treat as `false` (fail-safe) |
| `autoApprove.minScore` | number 0–10 | If absent or non-number, default to `7` |

No client-side form or server-side endpoint is involved.

## 14. Security & Permissions

- `dismissReview` requires the `GITHUB_TOKEN` to have `pull-requests: write`. This permission is already required by the `review-pr` workflow for `postReview()`, so no change to workflow permissions is needed.
- The bot filters by `user.login === 'github-actions[bot]'` before dismissing. This is validated locally — the API call is only made for the bot's own reviews.
- `GITHUB_TOKEN` is never logged.

## 15. Observability & Logging

Use `chalk` (already imported in `reviewer.ts`) for all console output.

**Log when:**
- Auto-approve conditions are evaluated (once per `reviewPullRequest()` call)
- Each dismiss attempt and its result
- APPROVE event is posted (instead of the existing "Review posteado" message)
- Conditions are NOT met and the reason (which condition failed)

**Never log:**
- `GITHUB_TOKEN` value
- Full review body or PR content

## 16. i18n / User-Facing Copy

All console output in `reviewer.ts` is in Spanish (rioplatense). New messages must follow the same style:

| Context | Message |
|---|---|
| Auto-approve triggered | `✓ Auto-aprobando PR #N: recomendación approve, sin findings bloqueantes.` |
| Dismissing a review | `  Descartando review #ID del bot...` |
| Dismiss success | `  ✓ Review #ID descartado.` |
| Dismiss failed (non-fatal) | `  ⚠ No se pudo descartar review #ID: <error message>` |
| Conditions not met | `ℹ Auto-approve: condiciones no cumplidas (<reason>). Posteando como COMMENT/REQUEST_CHANGES.` |
| Auto-approve disabled | (no output needed — current flow is unchanged) |

## 17. Performance

- One extra `GET /pulls/{n}/reviews` call per `reviewPullRequest()` run when `autoApprove.enabled: true`
- One `PUT /pulls/{n}/reviews/{id}/dismissals` per previous `REQUEST_CHANGES` bot review (typically 0 or 1)
- Both calls are sequential, after the LLM call completes — no impact on LLM latency
- Total overhead: ~200–400ms for typical PRs with 0–1 previous bot reviews

## 18. Restrictions

- **Do NOT modify `reviewSingleFile()` or `reviewLocalDiff()`** — auto-approve is only for `review-pr` (PR context required for GitHub reviews API).
- **Do NOT change `mapRecommendationToEvent()`** — replace its call site logic rather than modifying the function (or remove the function if it becomes unused).
- **Do NOT introduce new npm dependencies** — `@octokit/rest` already exposes `pulls.listReviews` and `pulls.dismissReview`.
- **Do NOT auto-approve when `dry-run` is active** — the dry-run flag already prevents `postReview()` from being called; the new code must respect this.
- **Do NOT touch `src/feedback-handler.ts` or `src/thread-resolver.ts`** — this feature is independent of the feedback system.
- **Do NOT approve when recommendation is `comment`** — only `approve` recommendation triggers the auto-approve flow.

## 19. Deliverables

- [ ] `AutoApproveConfig` interface in `src/types.ts`
- [ ] `autoApprove?: AutoApproveConfig` field on `ReviewerConfig` in `src/types.ts`
- [ ] `autoApprove` parsing with defaults in `src/config.ts`
- [ ] `listPullRequestReviews()` method on `GitHubClient` in `src/github.ts`
- [ ] `dismissReview()` method on `GitHubClient` in `src/github.ts`
- [ ] `shouldAutoApprove()` logic in `src/reviewer.ts`
- [ ] Dismiss + APPROVE flow in `reviewPullRequest()` in `src/reviewer.ts`
- [ ] Console output for auto-approve path
- [ ] 8 new test scenarios in `__test__/reviewer.test.ts`
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0

## 20. Final Agent Checklist

- [ ] Read this spec end-to-end before writing any code
- [ ] Confirmed `@octokit/rest` already has `pulls.listReviews` and `pulls.dismissReview` (no new dependency)
- [ ] Modified only the files listed in section 6
- [ ] Followed `FeedbackConfig` pattern for `AutoApproveConfig` in `src/types.ts`
- [ ] Followed existing method signature pattern in `src/github.ts` (typed object param, explicit return type)
- [ ] `shouldAutoApprove()` is a pure function with no side effects
- [ ] Dismiss failure is caught and non-fatal
- [ ] `dry-run` mode skips the approve flow (existing `opts.dryRun` check already does this)
- [ ] All 8 test scenarios are implemented with AAA pattern
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] No `any` or `unknown` types introduced
- [ ] No new dependencies added
- [ ] No changes to `reviewSingleFile()`, `reviewLocalDiff()`, `FeedbackHandler`, or `ThreadResolver`
