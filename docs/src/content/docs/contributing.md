---
title: Contributing
description: How to contribute to ai-code-reviewer — branching strategy, commit conventions, and security policy.
---

Contributions are welcome. Please read this page before opening an issue or pull request.

## Branching strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable release branch. Only receives PRs from `develop`. Requires 1 reviewer approval + CI green. |
| `develop` | Integration branch for day-to-day work. All feature/fix/chore branches merge here. Requires CI green. |
| `feature/<slug>` | New functionality |
| `fix/<slug>` | Bug fixes |
| `chore/<slug>` | Maintenance, deps, config |

Always branch from `develop`, not from `main`.

```bash
git checkout develop
git checkout -b feature/my-feature
# ... work ...
git push -u origin feature/my-feature
# open PR → develop
```

## CI

Every PR runs the CI workflow (`.github/workflows/ci.yml`):

```
npm ci → npm run build → npm test
```

The CI check must be green before any PR can be merged. PRs to `main` additionally require 1 reviewer approval.

## Commit message format

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short imperative description>
```

| Type | When to use |
|------|-------------|
| `feat` | New functionality |
| `fix` | Bug fix |
| `refactor` | Code change with no behavior change |
| `chore` | Config, deps, tooling, maintenance |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `ci` | CI/CD changes |
| `build` | Build system changes |

**Examples:**

```
feat(providers): add Gemini provider support
fix(github): handle missing GITHUB_EVENT_PATH gracefully
chore(deps): upgrade vitest to v3
```

## Development setup

```bash
git clone https://github.com/giolabs/ai-code-reviewer.git
cd ai-code-reviewer
npm install
```

Create a `.env` file with your API key:

```bash
OPENAI_API_KEY=sk-...
```

Run the CLI without a compile step:

```bash
npm run dev -- review-file src/reviewer.ts
npm run dev -- review-diff --staged
```

Build and run tests:

```bash
npm run build
npm test
```

## Opening a pull request

1. Branch from `develop`
2. Keep each PR focused on a single concern
3. Fill in the PR template — Summary, Type of change, Test plan, Related issues
4. CI must be green before requesting review
5. For PRs to `main`, 1 reviewer approval is required

## Reporting a security vulnerability

**Do not open a public issue for security vulnerabilities.**

Use [GitHub's private security advisory](https://github.com/giolabs/ai-code-reviewer/security/advisories/new) to report confidentially. See [SECURITY.md](https://github.com/giolabs/ai-code-reviewer/blob/main/SECURITY.md) for the full policy and response timeline.
