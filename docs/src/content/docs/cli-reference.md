---
title: CLI Reference
description: Complete reference for all ai-code-reviewer commands and flags.
---

## `review-pr`

Main mode: runs inside GitHub Actions on the current PR.

```bash
npx @giolabs/ai-code-reviewer review-pr [options]
```

Detects the PR from `GITHUB_EVENT_PATH`, fetches changed files via the GitHub API, calls the configured LLM, and posts the review with a summary comment and inline comments on the diff.

On JS/TS stacks, it automatically builds a 1-level dependency graph of the changed files and injects it into the LLM context. The PR summary includes two additional sections when non-empty:

- **🐛 Anticipated Bugs** — bugs likely to surface given the change.
- **⚠️ Regression Risks** — caller files that may break.

**Options**

| Flag | Description |
|---|---|
| `--dry-run` | Print the result without posting to the PR |
| `--save <path>` | Save a Markdown report at the given path |
| `-c, --config <path>` | Use an alternate config file |
| `-r, --rules <path>` | Use alternate custom rules |
| `-m, --model <model>` | Override the model |
| `-l, --language <es\|en>` | Override the review language |
| `-t, --tech <stack>` | Force a specific tech stack |
| `-p, --provider <name>` | Override the provider |

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Review posted; recommendation is `approve` or `comment` |
| `1` | Review posted with `request_changes`, or an error occurred |

**Required environment variables**

| Variable | Source |
|---|---|
| `OPENAI_API_KEY` (or equivalent) | GitHub Actions secret |
| `GITHUB_TOKEN` | Provided automatically by GitHub Actions |
| `GITHUB_EVENT_PATH` | Set automatically by GitHub Actions |
| `GITHUB_REPOSITORY` | Set automatically by GitHub Actions |

---

## `review-file <file>`

Reviews a single local file without touching git or a PR. Useful for iterating on rules before committing.

```bash
npx @giolabs/ai-code-reviewer review-file src/users/users.service.ts
```

The file is treated as if it were entirely new (all lines as additions). Output is printed to the terminal.

**Options:** same as `review-pr` except `--dry-run` (not applicable).

---

## `review-diff`

Reviews the output of `git diff` locally.

```bash
# Working tree vs HEAD
npx @giolabs/ai-code-reviewer review-diff

# Staged changes only
npx @giolabs/ai-code-reviewer review-diff --staged

# Changes since branching from main
npx @giolabs/ai-code-reviewer review-diff --base main
```

Useful as a pre-commit hook or a sanity check before pushing. See [Local Usage](./local-usage) for pre-commit hook setup.

**Options**

| Flag | Description |
|---|---|
| `--staged` | Review only staged changes |
| `--base <branch>` | Review diff from `<branch>...HEAD` |
| Plus all options from `review-pr` |  |

---

## `init`

Creates `.ai-review.yml` at the repo root with all defaults documented.

```bash
npx @giolabs/ai-code-reviewer init
```

If `.ai-review.yml` already exists, the command exits without overwriting it.
