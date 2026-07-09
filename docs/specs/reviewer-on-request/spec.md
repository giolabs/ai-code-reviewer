# Reviewer on Request

> **Status:** PENDING PROPOSAL/CHANGE — no OpenSpec change has been generated yet. Run `/openspec-propose` (or `/opsx:propose`) using this spec as input.

## 1. Goal

When a developer clicks "Request review" on a GitHub PR and selects the bot account, the AI review runs automatically — as if the PR had just been opened. The review result (findings, inline comments, summary) is posted exactly like today; the only change is the trigger event that starts the workflow.

## 2. Scope

### Included in this phase

- Add `review_requested` to the `pull_request` event types in `examples/.github/workflows/ai-review.yml`
- Update the corresponding docs pages (`docs/pages/getting-started.mdx` and `docs/pages/es/getting-started.mdx`) to mention the new trigger
- No source code changes — `getPullRequestContextFromEnv()` already parses the `pull_request` object that exists in `pull_request_review_requested` event payloads

### Out of scope

- CODEOWNERS configuration (auto-requesting the bot on every PR is a repository setup task, not part of this feature)
- GitHub App or bot account setup (depends on the user's infrastructure)
- Deduplication (if the PR was already reviewed by the `opened` trigger, a second review fires — no skip logic)
- Filtering by which reviewer was requested (the workflow runs for any `review_requested` event, not only when the bot is the requestee)
- Re-review suppression when the same commit was already reviewed
- Modifying `.github/workflows/ci.yml` (that's the project's own CI pipeline, not the example workflow for users)

## 3. Technologies & Conventions

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js `>=18.0.0`
- **Package manager**: npm
- **Build**: `tsc` → `dist/`
- **Test**: Vitest (`npm test` → `vitest run`)
- **GitHub API**: `@octokit/rest` — already a dependency
- **CI**: GitHub Actions (`examples/.github/workflows/ai-review.yml`)
- **No new dependencies required**

### Relevant versions (from `package.json`)

| Field | Value |
|---|---|
| `version` | `0.1.0-beta.4` |
| `node` engine | `>=18.0.0` |
| `typescript` | `^5.6.0` |
| `vitest` | `^3.2.6` |
| `@octokit/rest` | `^21.0.0` (already installed) |

### Existing patterns to follow

- `examples/.github/workflows/ai-review.yml` — the user-facing template workflow; new trigger goes here
- `getPullRequestContextFromEnv()` in `src/github.ts:351` — reads `event.pull_request` from the Actions event payload; no change needed
- Console output via `chalk` (Spanish, rioplatense) — no new strings for this feature

## 4. Prerequisites

- [x] `reviewPullRequest()` exists in `src/reviewer.ts` and is called by `review-pr`
- [x] `getPullRequestContextFromEnv()` in `src/github.ts:351` reads `event.pull_request` — present in `pull_request_review_requested` payloads
- [x] `examples/.github/workflows/ai-review.yml` exists as the user-facing template
- [x] `GITHUB_TOKEN` is available in the Actions environment with `pull-requests: write`
- [x] `pull_request_review_requested` GitHub event payload shape includes `pull_request.number`, `pull_request.head.sha`, `pull_request.base.sha`, `pull_request.title`, `pull_request.body` — same fields already consumed by `getPullRequestContextFromEnv()`

## 5. Architecture

**Pattern**: configuration-only change — no new code paths in `src/`.

**Affected layers**:

| Layer | Changed | Description |
|---|---|---|
| `examples/.github/workflows/ai-review.yml` | yes | Add `review_requested` to the `pull_request.types` list |
| `docs/pages/getting-started.mdx` | yes | Add a note that `review_requested` is now a trigger |
| `docs/pages/es/getting-started.mdx` | yes | Same note in Spanish |
| `src/` (any file) | no | No source changes needed |
| `src/github.ts` | no | `getPullRequestContextFromEnv()` already handles the event shape |

**Flow (when `review_requested` fires):**

1. Developer clicks "Request review" → selects bot account → GitHub dispatches `pull_request` event with `action: review_requested`
2. `ai-review.yml` triggers — the `if: github.event.pull_request.draft == false` condition applies as normal
3. `npx ai-code-reviewer@latest review-pr` runs — identical to the `opened` trigger path
4. `getPullRequestContextFromEnv()` reads `event.pull_request` → returns `PullRequestContext` with owner, repo, pullNumber, headSha, baseSha, title, body
5. Full review pipeline runs; findings posted as inline comments + summary review

**No new files created in `src/`.**

## 6. Files to Create / Modify

| Path | Action | Purpose | Follow |
|---|---|---|---|
| `examples/.github/workflows/ai-review.yml` | MODIFY | Add `review_requested` to `pull_request.types` | Existing entries in same file |
| `docs/pages/getting-started.mdx` | MODIFY | Document the new trigger | Other trigger entries in same page |
| `docs/pages/es/getting-started.mdx` | MODIFY | Same in Spanish | `docs/pages/getting-started.mdx` |

### Detail per file

**`examples/.github/workflows/ai-review.yml`**
- Add `- review_requested` to the `types` array under `pull_request`
- Do NOT change any other trigger, condition, env var, or step
- Final `types` list: `[opened, synchronize, reopened, ready_for_review, review_requested]`

**`docs/pages/getting-started.mdx`**
- In the workflow YAML snippet, add `- review_requested` to the `types` list
- Add a brief prose note after the snippet: "The workflow also fires when a reviewer is requested — add the bot account as a reviewer on any PR and the review starts automatically."
- Do NOT restructure the page or change unrelated sections

**`docs/pages/es/getting-started.mdx`**
- Mirror the same change in Spanish (rioplatense):
  "El workflow también se ejecuta cuando se solicita un reviewer — agregá la cuenta del bot como reviewer en cualquier PR y la revisión arranca automáticamente."

## 7. API Contract

No new API surface. `review_requested` is a standard GitHub Actions event type — no new endpoints are called. No `api-contract.md` needed.

## 8. Success Criteria

- [ ] After applying the change to their `ai-review.yml`, users can trigger a review by clicking "Request review" → selecting the bot account
- [ ] The `review_requested` event triggers the same review pipeline as `opened`
- [ ] Draft PRs are still skipped (`if: github.event.pull_request.draft == false` unchanged)
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0 (no tests changed — this is a workflow-only change)

### Required tests

No new tests required — `getPullRequestContextFromEnv()` is already tested by the existing suite, and the workflow YAML change has no unit-testable logic. Verification is done by a manual smoke test (see §9).

### Verification commands

```bash
npm run build    # must exit 0
npm test         # must exit 0
```

## 9. UX Criteria

This feature has no web UI. The end-user experience is:

1. Developer opens a PR → no automatic review fires (only if `opened` also in types)
2. Developer (or repo maintainer) clicks "Reviewers" → "Request review" → adds the bot account
3. Within seconds, GitHub Actions fires the workflow; the bot posts its review to the PR

**Console output**: no change from current behavior.

**On GitHub PR**:
- The bot appears in "Reviewers" with the pending review icon (⌛) until the workflow posts its result
- After completion: the bot's review shows as "Commented" or "Request changes" under "Reviewers"

## 10. Decisions Made (Locked)

- **No deduplication.** If both `opened` and `review_requested` fire for the same PR, two reviews run. Rationale: the second review runs after potentially more code is looked at; duplicate reviews are additive. Implementing dedup would require an extra API call and complex state tracking for minimal real-world benefit.
- **No requestee filtering.** The workflow fires on any `review_requested` event regardless of which reviewer was requested. Rationale: filtering by `github.event.requested_reviewer.login` is fragile (bot login depends on the user's setup) and adds complexity. Teams can use `if:` conditions in their own `ai-review.yml` if needed.
- **Examples-only change.** Only `examples/.github/workflows/ai-review.yml` is modified — not the project's own `.github/workflows/ci.yml`. Rationale: the project's CI only needs to test the tool itself; the review workflow is a template for user repos.
- **No source code change.** `getPullRequestContextFromEnv()` already handles `pull_request_review_requested` payloads because both `pull_request` and `pull_request_review_requested` events contain a `pull_request` object with the same fields.

## 11. Edge Cases

| Case | Expected behavior |
|---|---|
| PR is a draft when reviewer requested | `if: github.event.pull_request.draft == false` skips the job — no review posted |
| Bot is requested by its own workflow (e.g., as part of CODEOWNERS auto-request on push) | Review fires normally — no infinite loop because the review-pr command does not itself request reviewers |
| `review_requested` and `synchronize` fire simultaneously | Two independent workflow runs — both complete, two reviews posted |
| `GITHUB_TOKEN` lacks `pull-requests: write` | `postReview()` returns 403 — existing error handling logs and exits 1 |
| PR is closed or merged before the workflow finishes | Octokit returns 422 on `postReview()` — caught and logged by existing error handling |
| No `pull_request.head.sha` in payload | `getPullRequestContextFromEnv()` returns `headSha: ''` — review runs but diff may be empty |

## 12. Required UI States

Not applicable — this is a CLI/CI tool with no web UI.

## 13. Validations

No new input validation. The `review_requested` event type is a GitHub-defined constant — no user-supplied value is involved.

## 14. Security & Permissions

- `review_requested` events require the same `pull-requests: write` permission already declared in the workflow — no change to `permissions:` block
- `GITHUB_TOKEN` is never logged — existing behavior unchanged
- No new environment variables required

## 15. Observability & Logging

No new logging. The existing pipeline (`reviewPullRequest()`) logs:
- Files being reviewed
- LLM call completion
- Number of findings
- Review posted confirmation

The trigger event (opened vs review_requested) is not surfaced in logs — no change needed.

## 16. i18n / User-Facing Copy

One new prose line per docs page:

| File | New copy |
|---|---|
| `docs/pages/getting-started.mdx` | "The workflow also fires when a reviewer is requested — add the bot account as a reviewer on any PR and the review starts automatically." |
| `docs/pages/es/getting-started.mdx` | "El workflow también se ejecuta cuando se solicita un reviewer — agregá la cuenta del bot como reviewer en cualquier PR y la revisión arranca automáticamente." |

No changes to CLI output strings in `src/`.

## 17. Performance

- No additional API calls
- No change to review pipeline latency
- One extra GitHub Actions job run per `review_requested` event — same resource cost as an `opened` trigger

## 18. Restrictions

- **Do NOT modify `src/` files** — the feature requires zero source changes
- **Do NOT modify `.github/workflows/ci.yml`** — that is the project's own CI pipeline, not the user-facing template
- **Do NOT add `review_requested` to `handle-feedback.yml`** — feedback handling is triggered by `pull_request_review_comment`, not PR events
- **Do NOT add requestee filtering** — see §10
- **Do NOT add deduplication logic** — see §10
- **Do NOT change the `if: draft == false` condition** — draft skip behavior must remain

## 19. Deliverables

- [ ] `examples/.github/workflows/ai-review.yml` updated with `review_requested` in types
- [ ] `docs/pages/getting-started.mdx` updated with new trigger documentation
- [ ] `docs/pages/es/getting-started.mdx` updated with Spanish equivalent
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0

## 20. Final Agent Checklist

- [ ] Read this spec end-to-end before writing any code
- [ ] Verified `getPullRequestContextFromEnv()` in `src/github.ts:351` parses `event.pull_request` — present in `review_requested` payloads
- [ ] Modified only the three files listed in §6
- [ ] Did NOT touch any file under `src/`
- [ ] Did NOT touch `.github/workflows/ci.yml`
- [ ] Docs prose matches §16 copy exactly (English and Spanish)
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] No new dependencies added
- [ ] No draft-skip condition changed
