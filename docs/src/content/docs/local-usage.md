---
title: Local Usage
description: Run the reviewer locally with review-file, review-diff, and as a pre-commit hook.
---

All three commands work locally without a GitHub repository. You only need an API key for your chosen provider.

## Setup

Create a `.env` file at the root of the project you want to review:

```bash
# OpenAI (default)
OPENAI_API_KEY=sk-...

# Anthropic
# ANTHROPIC_API_KEY=sk-ant-...

# Gemini
# GEMINI_API_KEY=AI...
```

`dotenv` is loaded automatically. For Ollama, no key is needed — just have the service running at `http://localhost:11434`.

## Review a single file

```bash
npx @giolabsuy/ai-code-reviewer review-file src/users/users.service.ts
```

Useful when iterating on your rules: make a change to `code-review-rules.md`, re-run `review-file`, see if the finding appears or disappears.

## Review staged changes

```bash
npx @giolabsuy/ai-code-reviewer review-diff --staged
```

Reviews the output of `git diff --cached`. Run this before committing to catch issues early.

## Review against a base branch

```bash
npx @giolabsuy/ai-code-reviewer review-diff --base main
```

Equivalent to `git diff main...HEAD`. Useful for a full review of a feature branch before opening a PR.

## Pre-commit hook

Wire `review-diff --staged` as a pre-commit hook to get inline feedback before every commit.

### With Husky

```bash
npm install --save-dev husky
npx husky init
```

Then edit `.husky/pre-commit`:

```bash
#!/bin/sh
npx @giolabsuy/ai-code-reviewer review-diff --staged --min-severity major
```

This runs the reviewer on staged changes and exits `1` if there are `major` or `critical` findings, blocking the commit.

### Without Husky (raw git hook)

Create `.git/hooks/pre-commit` and make it executable:

```bash
#!/bin/sh
npx @giolabsuy/ai-code-reviewer review-diff --staged --min-severity major
```

```bash
chmod +x .git/hooks/pre-commit
```

:::tip
Use `--min-severity major` in pre-commit hooks to avoid blocking commits on `minor`/`nitpick` findings. Save those for the full PR review.
:::

## Save a Markdown report

Any command accepts `--save <path>` to write a full Markdown report:

```bash
npx @giolabsuy/ai-code-reviewer review-diff --base main --save review-report.md
```
