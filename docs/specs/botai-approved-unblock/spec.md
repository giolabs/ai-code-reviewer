# `@botai approved` Unblock after False Positives

> **Status:** READY FOR IMPLEMENTATION

## 1. Goal

When a developer posts `@botai approved` (general PR comment or inline), the bot must fully clear its own blocking review state: dismiss prior `CHANGES_REQUESTED` reviews, submit a real GitHub `APPROVE`, and suppress open findings so they are not re-flagged on the next push. This is the human escape hatch after false-positive `REQUEST_CHANGES`.

## 2. Scope

### Included in this phase

- `GitHubClient.dismissBotChangesRequestedReviews(...)` extracted from reviewer auto-approve logic.
- `submitApprovalReview` returns success/failure (no silent-only warn).
- `FeedbackHandler.handleApproved`: dismiss → APPROVE → suppress open findings (fingerprint + status Dismissed + resolve threads).
- Visible reply on APPROVE failure.
- Tests + CHANGELOG + handle-feedback docs note.
- Spec file (this document).

### Out of scope

- Changing default `process.exitCode = 1` on `REQUEST_CHANGES`.
- Re-running the ai-review workflow from feedback.
- Wiring FindingVerifier into incremental reviews.
- Branch protection changes in consumer repos.

## 3. Technologies & conventions

### Stack

- TypeScript ESM, Vitest, Octokit (existing).
- No new dependencies.

### Relevant versions

From `package.json`: `0.1.0-beta.17`, vitest `^3.2.6`, `@octokit/rest` `^21.0.0`.

### Patterns to follow

- `dismissBotReviews` in `src/reviewer.ts` — behaviour to move into `GitHubClient`.
- `handleDismiss` — fingerprint suppress + status update.
- CLAUDE.md: class methods, typed option objects, no `any`/`unknown`.

## 4. Prerequisites

- [x] `listPullRequestReviews` / `dismissReview` exist on `GitHubClient`.
- [x] `submitApprovalReview` exists.
- [x] `addSuppressedFingerprint` / `extractFindingMetadata` / `getPullRequestReviewComments` exist.
- [x] `@botai approved` already routes from `issue_comment` and inline.

## 5. Architecture

```
@botai approved
    → reply ack
    → dismissBotChangesRequestedReviews
    → submitApprovalReview (boolean)
        fail → reply error, stop suppress? still suppress open findings (locked: suppress only after successful APPROVE)
    → for each open bot finding: suppress fingerprint + mark Dismissed + resolveThread
```

**Locked:** suppress only after successful APPROVE so a failed approve does not hide findings while the PR stays blocked.

## 6. Files to create or modify

| Path | Action | Purpose |
|---|---|---|
| `docs/specs/botai-approved-unblock/spec.md` | NUEVO | This spec |
| `src/github.ts` | MODIFICAR | dismiss helper; APPROVE returns boolean |
| `src/reviewer.ts` | MODIFICAR | Use new dismiss helper |
| `src/feedback-handler.ts` | MODIFICAR | handleApproved flow |
| `__test__/feedback-handler.test.ts` | MODIFICAR | New scenarios |
| `__test__/github.test.ts` | MODIFICAR | dismiss helper / APPROVE result if needed |
| `CHANGELOG.md` | MODIFICAR | Unreleased entry |
| `docs/pages/handle-feedback.mdx` | MODIFICAR | Document dismiss + suppress |

## 7. API Contract

Sin API surface — no aplica.

## 8. Success criteria

### Tests required

- `@botai approved` (issue_comment) calls dismiss before APPROVE.
- APPROVE failure → error reply; no suppress; no success log pretending approve worked.
- Successful approve → open finding fingerprints suppressed and threads resolved.

### Verification commands

```bash
npm test
npm run build
```

## 9. UX criteria

No aplica — bot/CLI. User-facing: Spanish/English replies for ack and APPROVE failure.

## 10. Decisions made (locked)

1. Dismiss all `github-actions[bot]` `CHANGES_REQUESTED` before APPROVE (parity with auto-approve).
2. `submitApprovalReview` returns `boolean` (`true` on success).
3. Suppress open findings only after successful APPROVE.
4. Do not change CI exit-code defaults this phase.
5. Extract dismiss into `GitHubClient` so FeedbackHandler does not import reviewer.

## 11. Edge cases

| Case | Behaviour |
|---|---|
| No prior CHANGES_REQUESTED | Dismiss is no-op; APPROVE proceeds |
| Dismiss 422 | Already swallowed by `dismissReview`; continue |
| APPROVE 403/422 | Return false; reply with error; no suppress |
| No open findings | Suppress loop no-op |
| Missing context comment | `addSuppressedFingerprint` no-ops (existing) |
| Orphan findings in summary | Out of scope this phase (inline open findings only) |

## 12. Required UI states

No aplica.

## 13. Validations

No client/server form validations. APPROVE API errors surfaced in reply text (truncated).

## 14. Security & permissions

- Requires existing `pull-requests: write`.
- Never log `GITHUB_TOKEN`.
- Only dismiss reviews from `github-actions[bot]`, never human reviewers.

## 15. Observability & logging

- Keep green success log on approve.
- Dim logs per dismissed review (existing pattern).
- Yellow/warn on dismiss list failure (existing).

## 16. i18n / user-facing copy

| Situation | ES | EN |
|---|---|---|
| Ack | `@${actor} aprobó este PR. Procediendo a aprobar.` | existing |
| APPROVE fail | `No se pudo aprobar el PR: ${msg}. Revisá permisos del token (\`pull-requests: write\`).` | `Could not approve the PR: ${msg}. Check token permissions (\`pull-requests: write\`).` |

## 17. Performance

- One listReviews + N dismiss + one createReview + one list review comments + M suppress updates. Acceptable for feedback job.

## 18. Restrictions

- Do not dismiss human reviews.
- Do not auto-merge.
- Do not clear CI check conclusions.
- Do not enable learnings auto-capture for bulk approve suppress (unlike single `@botai dismiss`).

## 19. Deliverables

- [ ] Spec
- [ ] GitHubClient helper + APPROVE boolean
- [ ] handleApproved hardened
- [ ] reviewer uses helper
- [ ] Tests
- [ ] CHANGELOG + docs

## 20. Final agent checklist

- [ ] Spec followed
- [ ] Only listed files
- [ ] AAA tests
- [ ] `npm test` / `npm run build` pass
- [ ] No `any` / `unknown`
