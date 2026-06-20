---
title: Quick Start
description: Add AI-powered code review to any GitHub repository in four steps.
---

Add AI code review to any GitHub repository in four steps.

## 1. Add the workflow

Create `.github/workflows/ai-review.yml` in your repo:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx -y @giolabsuy/ai-code-reviewer@latest review-pr
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 2. Add your API key

The default provider is OpenAI. Add the secret to your repo: **Settings → Secrets and variables → Actions → New repository secret**

- **Name:** `OPENAI_API_KEY`
- **Value:** your key from [platform.openai.com](https://platform.openai.com)

To use a different provider (Anthropic, Gemini, Ollama), see [Providers](./providers).

`GITHUB_TOKEN` is provided automatically by GitHub — no action needed.

## 3. (Optional) Configure project rules

```bash
npx @giolabsuy/ai-code-reviewer init
```

This creates `.ai-review.yml` at the root of your repo with all defaults documented. Edit to your liking. See [Configuration](./configuration) for the full reference.

## 4. Open a PR

The next PR you open triggers the workflow. The reviewer posts inline comments on lines with findings and a general summary with score and recommendation.

---

## What happens on each PR

1. The workflow checks out your repo and runs `npx @giolabsuy/ai-code-reviewer@latest review-pr`
2. The CLI reads `.ai-review.yml` (if present) and detects your tech stack
3. On JS/TS stacks, it builds a 1-level dependency graph of the changed files
4. It sends the diffs + context to the configured LLM
5. Results are posted as inline comments on the PR diff, plus a summary comment with score, recommendation, anticipated bugs, and regression risks
6. If the recommendation is `request_changes`, the workflow exits with code `1` — useful for blocking merges via branch protection rules
