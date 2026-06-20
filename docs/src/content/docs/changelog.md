---
title: Changelog
description: Version history for ai-code-reviewer.
---

## Unreleased

### Added

- **Branch protection** — `main` requires 1 reviewer approval + CI green; `develop` requires CI green. Direct pushes to both branches are blocked.
- **CI workflow** (`.github/workflows/ci.yml`) — runs `npm run build && npm test` on every PR targeting `main` or `develop`.
- **`develop` branch** — new integration branch; all feature/fix/chore work merges here before reaching `main`.
- **CONTRIBUTING.md** — branching strategy, commit conventions, development setup, and PR checklist.
- **SECURITY.md** — private vulnerability disclosure via GitHub Advisory; response timeline 48h acknowledge / 14–30d patch.
- **PR template** and **issue templates** (bug report, feature request) under `.github/`.

---

## 0.1.0-beta.1 — 2026-06-20

First public beta.

### Added

- **Multi-provider support** — OpenAI, Anthropic (`claude-sonnet-4-20250514`), Gemini (`gemini-1.5-flash`), and Ollama. Switch with `provider:` in `.ai-review.yml`.
- **Dependency graph context** — On JS/TS stacks, analyzes 1-level imports and importers of changed PR files via `madge` and injects the graph into the LLM prompt.
- **Anticipated bugs** — The model reports bugs likely to surface in the future given the change, surfaced as a separate section in the PR summary.
- **Regression risk report** — Identifies caller files that may break as a result of the change.
- **Built-in rule templates** for 8 tech stacks: NestJS, Next.js, React, TypeScript, Node, Flutter, Laravel, Generic.
- **Local commands** — `review-file <path>`, `review-diff`, `review-diff --staged`, `review-diff --base <branch>`.
- **Configurable via `.ai-review.yml`** — severity filter, ignore globs, max file size, check categories, custom rules file, `customInstructions`.
- **Inline comments + PR summary** with severity-coded findings, overall score, and recommendation.
- **Exit code 1** when recommendation is `request_changes` — enables blocking merges via branch protection rules.
- **`init` command** — scaffolds a pre-filled `.ai-review.yml` with all defaults documented.
