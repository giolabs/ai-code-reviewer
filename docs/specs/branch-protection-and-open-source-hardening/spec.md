# Branch Protection and Open Source Hardening

> **Status:** DRAFT

## 1. Goal

Harden the `giolabs/ai-code-reviewer` GitHub repository so that no one can push directly to `main` or `develop`, all changes go through a reviewed PR with a passing CI, and external contributors find the standard open-source governance files they expect (CONTRIBUTING.md, SECURITY.md, PR template, issue templates).

## 2. Scope

### Included in this phase

- Create the `develop` branch as the integration branch for day-to-day work
- Configure GitHub branch protection rules on `main`: block direct push, require 1 reviewer approval, require CI to pass; admins can bypass
- Configure GitHub branch protection rules on `develop`: block direct push, require CI to pass; no review required; admins can bypass
- Create `.github/workflows/ci.yml` — runs `npm run build && npm test` on every PR targeting `main` or `develop`
- Create `CONTRIBUTING.md` — branching strategy, how to open issues, how to run locally, PR checklist
- Create `SECURITY.md` — vulnerability disclosure policy, contact, response timeline
- Create `.github/pull_request_template.md` — structured PR description template
- Create `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`

### Out of scope

- `CODE_OF_CONDUCT.md` — deferred to a future phase
- npm trusted publishers / GitHub OIDC — deferred; current token-based publish stays as-is
- Commit message linting (e.g., commitlint) — no linter configured; document convention in CONTRIBUTING.md only
- Automated release workflow (semantic-release, changesets) — deferred
- Setting GitHub team permissions (org-level) — manual action by repo admin, not scripted
- Any changes to `src/`, `templates/`, `__test__/`, `dist/`, or `docs/` website content

## 3. Technologies & Conventions

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js `>=18.0.0` (`engines` in `package.json`)
- **Package manager**: npm
- **Build**: `tsc` → `dist/`
- **Test**: Vitest (`npm test` → `vitest run`)
- **CI**: GitHub Actions

### Relevant versions (from `package.json`)

| Field | Value |
|---|---|
| `version` | `0.1.0-beta.1` |
| `node` engine | `>=18.0.0` |
| `typescript` | `^5.6.0` |
| `vitest` | `^3.2.6` |

### Existing patterns to follow

- GitHub Actions workflows live under `.github/workflows/` — the only existing workflow is `.github/workflows/deploy-docs.yml`; follow its structure for the new CI file
- Commit messages follow Conventional Commits (documented in CLAUDE.md) — CONTRIBUTING.md must reflect this
- All code and identifiers in English; CLI output and README in Spanish — governance docs (CONTRIBUTING.md, SECURITY.md, templates) are in **English** (open-source audience)
- Branch naming: `feature/<slug>`, `fix/<slug>`, `chore/<slug>` — document in CONTRIBUTING.md

## 4. Prerequisites

- [x] Repository `giolabs/ai-code-reviewer` exists on GitHub
- [x] `main` branch exists and is the current default branch
- [x] `npm run build` passes clean (no TypeScript errors)
- [x] `npm test` passes (Vitest suite green)
- [ ] Repo admin access confirmed (required to set branch protection rules)
- [ ] `develop` branch does not exist yet — must be created from current `main`

## 5. Architecture

### Pattern

Repository governance layer: GitHub branch protection rules (GitHub API / UI) + new static files in `.github/` and repo root. No application code changes. No compilation dependency.

### Affected layers

| Layer | Affected? | Description |
|---|---|---|
| `.github/workflows/ci.yml` | **Yes — NEW** | CI workflow triggered on PRs |
| `.github/workflows/deploy-docs.yml` | No | Existing docs deploy — untouched |
| `CONTRIBUTING.md` | **Yes — NEW** | Contribution guide |
| `SECURITY.md` | **Yes — NEW** | Vulnerability disclosure policy |
| `.github/pull_request_template.md` | **Yes — NEW** | PR description template |
| `.github/ISSUE_TEMPLATE/bug_report.md` | **Yes — NEW** | Bug report template |
| `.github/ISSUE_TEMPLATE/feature_request.md` | **Yes — NEW** | Feature request template |
| GitHub branch protection rules | **Yes — manual config** | Set via `gh` CLI after files are merged |
| `src/`, `dist/`, `templates/`, `__test__/` | No | No changes |

### Expected flow

1. Implementer creates `develop` branch from current `main` HEAD
2. Implementer creates all new files listed above in a PR from a feature branch → `develop`
3. Once CI passes on that PR and it merges to `develop`, a second PR `develop` → `main` delivers everything
4. Repo admin configures branch protection rules on `main` and `develop` via `gh` CLI or GitHub UI
5. From that point: all future changes require a PR with passing CI; PRs to `main` also need 1 approval

### CI flow per PR

```
PR opened/updated → ci.yml triggers →
  1. actions/checkout@v4
  2. actions/setup-node@v4 (node 20)
  3. npm ci
  4. npm run build
  5. npm test
→ pass/fail reported as required status check
```

## 6. Files to Create / Modify

| Path | Action | Purpose | Example to follow |
|---|---|---|---|
| `.github/workflows/ci.yml` | NEW | Run build + tests on PRs | `.github/workflows/deploy-docs.yml` |
| `CONTRIBUTING.md` | NEW | Contribution guide for external contributors | `docs/specs/beta-release-prep/spec.md` (prose style) |
| `SECURITY.md` | NEW | Vulnerability disclosure policy | Standard GitHub security policy pattern |
| `.github/pull_request_template.md` | NEW | Structured PR template | — |
| `.github/ISSUE_TEMPLATE/bug_report.md` | NEW | Bug report issue template | — |
| `.github/ISSUE_TEMPLATE/feature_request.md` | NEW | Feature request issue template | — |

### Detail per file

#### `.github/workflows/ci.yml`

Triggers on `pull_request` targeting `main` or `develop`. Steps: checkout, setup-node (v20), `npm ci`, `npm run build`, `npm test`. Job name: `ci`. Do NOT add caching (keep it simple for now). Do NOT trigger on push (branch protection requires the CI check from a PR trigger). This workflow's job name (`ci`) is what gets registered as the required status check in branch protection.

Must NOT: run `npm publish`, modify secrets, or duplicate logic from `deploy-docs.yml`.

#### `CONTRIBUTING.md`

Sections (in order):
1. **Prerequisites** — Node.js ≥18, npm, `OPENAI_API_KEY` in `.env`
2. **Development setup** — `git clone`, `npm install`, `npm run dev`
3. **Branching strategy** — `main` is the stable/release branch, `develop` is the integration branch; create feature/fix/chore branches from `develop`; PRs go to `develop` first, then `develop` → `main` for releases
4. **Commit message format** — Conventional Commits: `feat(scope): description`, `fix(scope): description`, etc. with the full type table
5. **Running tests** — `npm test` and `npm run build`
6. **Opening a PR** — checklist: branch from develop, one concern per PR, fill in the PR template, CI must be green
7. **Reporting bugs** — use the bug report issue template

Must be in **English**. No Spanish prose. Length: ~80–120 lines.

#### `SECURITY.md`

Sections:
1. **Supported versions** — table showing `0.1.0-beta.*` as receiving security fixes; older versions not supported
2. **Reporting a vulnerability** — instruct reporter to use GitHub's private security advisory (Security → Advisories → "Report a vulnerability") rather than opening a public issue
3. **Response timeline** — acknowledge within 48h, patch within 14 days for critical, 30 days for lower severity
4. **Scope** — what counts as a vulnerability in this project (e.g., prompt injection via user config, API key exposure, RCE via review output)
5. **Out of scope** — theoretical issues with no real-world impact, third-party LLM provider bugs

Must NOT include email addresses or internal contact info.

#### `.github/pull_request_template.md`

Sections:
- `## Summary` (1–3 bullet points describing what changed)
- `## Type of change` (checklist: Bug fix / New feature / Refactor / Docs / Chore)
- `## Test plan` (how to verify the change works)
- `## Related issues` (closes #N or N/A)
- `## Checklist` (CI passes, tests added/updated if applicable, docs updated if applicable)

#### `.github/ISSUE_TEMPLATE/bug_report.md`

Frontmatter: `name: Bug report`, `about: Report a reproducible bug`, `labels: bug`. Sections: `## Describe the bug`, `## Steps to reproduce`, `## Expected behavior`, `## Actual behavior`, `## Environment` (Node.js version, OS, package version, provider used).

#### `.github/ISSUE_TEMPLATE/feature_request.md`

Frontmatter: `name: Feature request`, `about: Suggest a new feature or improvement`, `labels: enhancement`. Sections: `## Problem to solve`, `## Proposed solution`, `## Alternatives considered`, `## Additional context`.

## 7. API Contract

Not applicable — no API surface changes. GitHub branch protection rules are configured via `gh` CLI (manual step, not a code artifact).

## 8. Success Criteria

- [ ] `develop` branch exists on the remote (`git ls-remote --heads origin develop` returns a result)
- [ ] `.github/workflows/ci.yml` exists and triggers correctly on PRs — verified by opening a test PR
- [ ] CI job `ci` reports pass/fail as a status check on PRs
- [ ] `main` branch protection rules active: direct push rejected, 1 approval required, CI check required
- [ ] `develop` branch protection rules active: direct push rejected, CI check required, no approval required
- [ ] `CONTRIBUTING.md` exists, has all 7 sections, is in English
- [ ] `SECURITY.md` exists, has private advisory reporting instructions, is in English
- [ ] `.github/pull_request_template.md` exists with all 5 sections
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md` exist
- [ ] `npm run build` exits 0 after adding all new files (no TypeScript impact expected, but verify)
- [ ] `npm test` exits 0 (no test changes needed, but verify existing suite still passes)

### Tests required

No new tests — all new artifacts are configuration files and Markdown. Existing Vitest suite must continue to pass unchanged.

### Verification commands

```bash
# Branch exists
git ls-remote --heads origin develop

# CI workflow syntax valid
gh workflow list

# Build + test unaffected
npm run build
npm test

# Branch protection (requires gh CLI with admin token)
gh api repos/giolabs/ai-code-reviewer/branches/main/protection
gh api repos/giolabs/ai-code-reviewer/branches/develop/protection
```

## 9. UX Criteria

Not applicable — no user-facing interface or CLI changes.

## 10. Decisions Made (Locked)

| Decision | Why |
|---|---|
| `develop` as integration branch, `main` as release branch | Cleanly separates WIP from published releases; matches git-flow lite for a public package |
| 1 required reviewer on `main`, 0 on `develop` | `develop` is for integration (velocity matters); `main` gating needs a second pair of eyes before a release lands |
| Admin bypass allowed on both branches | Enables emergency hotfixes without ceremony; documented as an exception in CONTRIBUTING.md |
| CI runs `npm run build && npm test` only | No linter configured; adding lint to CI without a configured linter would always fail |
| English for all governance docs | Package is public on npm; English maximizes contributor reach |
| No `CODE_OF_CONDUCT.md` in this phase | Deferred to keep scope small; add in a follow-up once the community starts forming |
| No npm OIDC in this phase | Token-based publish works; OIDC migration is a separate concern with its own risk surface |
| Node 20 in CI | Matches the deploy-docs.yml workflow; Astro 6 requires >=22 for docs but the package itself supports >=18 — using 20 is a safe middle ground that tests the stated engine floor |

## 11. Edge Cases

### Invalid inputs

Not applicable — no runtime user input.

### Branch protection edge cases

- **First PR after enabling protection**: the CI check must have run at least once on the branch before GitHub recognizes it as a required status check by name. The admin must configure the required check by name (`ci`) after the first CI run.
- **Admin force-push**: allowed by design (admin bypass). Document in CONTRIBUTING.md that this is for emergencies only.
- **Bot PRs (e.g., Dependabot)**: will require CI to pass like any PR. On `main`, will also require 1 approval. Dependabot PRs targeting `develop` can auto-merge if CI passes.
- **Stale reviews on new commits**: GitHub's default behavior (review is not dismissed on new commits) is acceptable for a small team; if needed, enable "dismiss stale reviews" later.

### CI edge cases

- **`npm ci` fails because `package-lock.json` is out of date**: the lockfile must be committed and up-to-date. If the CI fails on this, the fix is to run `npm install` locally and commit the updated lockfile.
- **Flaky test causes CI failure**: the implementer does not need to fix flaky tests in this task; the suite currently passes clean.

## 12. Required UI States

Not applicable — no UI changes.

## 13. Validations

Not applicable — no form or API input validation.

## 14. Security & Permissions

- Branch protection rules require **repository admin** permission to set. Verify admin access before attempting.
- `SECURITY.md` must instruct reporters to use GitHub's private security advisory feature — never a public issue — to avoid disclosing vulnerabilities before a fix is available.
- `SECURITY.md` must NOT include personal email addresses.
- The CI workflow must NOT have access to `GITHUB_TOKEN` with write permissions beyond what GitHub Actions grants by default (read content + write statuses). No `permissions:` block needed unless explicitly adding PR write access.
- No secrets should be referenced in any of the new files. `OPENAI_API_KEY` and `GITHUB_TOKEN` are already documented in existing workflows; CONTRIBUTING.md references them as setup prerequisites only.

## 15. Observability & Logging

Not applicable — GitHub Actions logs CI runs automatically. Branch protection changes are tracked in the GitHub audit log.

## 16. i18n / User-facing copy

All new files (`CONTRIBUTING.md`, `SECURITY.md`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/*.md`) are in **English**. No Spanish prose. This is consistent with the decision to target a broad open-source contributor audience. The existing README and CLI output remain in Spanish (rioplatense) as per CLAUDE.md.

## 17. Performance

Not applicable.

## 18. Restrictions

The implementer must NOT:

- [ ] Modify any file under `src/`, `templates/`, `__test__/`, or `dist/`
- [ ] Change `package.json`, `package-lock.json`, or any existing workflow file (including `deploy-docs.yml`)
- [ ] Add new npm dependencies
- [ ] Write Spanish prose in the new English governance docs
- [ ] Configure branch protection rules without admin access confirmed
- [ ] Skip the CI workflow — branch protection requires a named status check, and the check must exist before it can be listed as required
- [ ] Use `npm install` in the CI workflow — use `npm ci` (reproducible installs from lockfile)
- [ ] Add caching to the CI workflow in this phase (keep it simple)
- [ ] Enable "Require signed commits" in branch protection — not configured in this project

## 19. Deliverables

- [ ] `develop` branch created and pushed to remote
- [ ] `.github/workflows/ci.yml` created
- [ ] `CONTRIBUTING.md` created at repo root
- [ ] `SECURITY.md` created at repo root
- [ ] `.github/pull_request_template.md` created
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md` created
- [ ] `.github/ISSUE_TEMPLATE/feature_request.md` created
- [ ] Branch protection rules configured on `main` (requires admin — manual step after CI workflow is live)
- [ ] Branch protection rules configured on `develop` (requires admin — manual step after CI workflow is live)
- [ ] `npm run build` still passes
- [ ] `npm test` still passes

## 20. Final Agent Checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] All 7 new files created — none missing
- [ ] `.github/workflows/ci.yml` uses `npm ci` (not `npm install`), runs on `pull_request` targeting `main` and `develop`, job name is `ci`
- [ ] `CONTRIBUTING.md` has all 7 sections, in English, ≤120 lines
- [ ] `SECURITY.md` references GitHub private security advisory (not email), has response timeline, in English
- [ ] `.github/pull_request_template.md` has all 5 sections
- [ ] Both issue templates have correct frontmatter (`name`, `about`, `labels`)
- [ ] No Spanish prose in any of the new English files
- [ ] No changes to `src/`, `templates/`, `__test__/`, `dist/`, or existing workflow files
- [ ] `npm run build` → exit 0
- [ ] `npm test` → green (no new tests needed, existing suite unchanged)
- [ ] `develop` branch pushed to remote before configuring branch protection
- [ ] Branch protection rules verified via `gh api` calls (see Section 8)
