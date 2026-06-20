# Contributing to @giolabsuy/ai-code-reviewer

Thank you for your interest in contributing! Please read this guide before opening an issue or pull request.

## Prerequisites

- Node.js ≥ 18.0.0
- npm ≥ 9
- An `OPENAI_API_KEY` (or equivalent) in a `.env` file at the repo root for manual testing

## Development setup

```bash
git clone https://github.com/giolabs/ai-code-reviewer.git
cd ai-code-reviewer
npm install
cp .env.example .env   # add your API key
```

Run the CLI without a compile step:

```bash
npm run dev -- review-file src/reviewer.ts
npm run dev -- review-diff --staged
```

Build and test:

```bash
npm run build   # tsc → dist/
npm test        # Vitest suite
```

## Branching strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable release branch — only receives PRs from `develop` |
| `develop` | Integration branch — all feature/fix/chore branches merge here |
| `feature/<slug>` | New functionality |
| `fix/<slug>` | Bug fixes |
| `chore/<slug>` | Maintenance, deps, config |

Always branch from `develop`, not from `main`.

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

Examples:

```
feat(providers): add Gemini provider support
fix(github): handle missing GITHUB_EVENT_PATH gracefully
chore(deps): upgrade vitest to v3
```

## Running tests

```bash
npm test                    # run all tests once
npm run test:watch          # watch mode
npm run build               # TypeScript compile check
```

All tests must pass before opening a PR. Do not add `// @ts-ignore` or `any` types to make tests compile — fix the type instead.

## Opening a PR

1. Branch from `develop`: `git checkout -b feature/my-feature develop`
2. Keep each PR focused on a single concern
3. Fill in the PR template completely
4. CI must be green before requesting review
5. PRs targeting `main` require 1 reviewer approval; PRs to `develop` only require CI to pass

## Reporting bugs

Use the [bug report template](https://github.com/giolabs/ai-code-reviewer/issues/new?template=bug_report.md). Include your Node.js version, OS, package version, and provider used.

For security vulnerabilities, see [SECURITY.md](./SECURITY.md).
