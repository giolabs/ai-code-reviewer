# ai-code-reviewer

> AI-powered code review for GitHub Pull Requests, configurable per project and tech stack. Designed to run as a step in GitHub Actions.

Drop it into your repo, define your rules, and let an AI Senior reviewer go through every PR with inline comments and a general summary.

---

## Features

- **Plug & play in GitHub Actions** — one YAML job and you're done.
- **Project-configurable rules** — `.ai-review.yml` file + optional `code-review-rules.md` with team-specific prompts.
- **Auto tech stack detection** (NestJS, React, Next.js, TypeScript, Node, Flutter, Laravel) with built-in rule templates for each.
- **Inline comments + summary** on the PR, with color-coded severity.
- **Local commands** (`review-file`, `review-diff`) to iterate on rules without opening a PR.
- **Filters**: minimum severity, ignored files, max file size, check categories.
- **Dependency graph context** — in `review-pr`, analyzes the imports and callers of the PR's changed files and injects them into the LLM prompt for structural project context (requires JS/TS stack).
- **Anticipated bugs and regression risk report** — in addition to the code review, the model reports bugs likely to surface in the future and caller files that may break with the change.
- **Structured output** — OpenAI uses `response_format: json_schema`; other providers receive explicit formatting instructions. The model's raw text is never parsed with regex.

---

## Quick start

### 1. Add the workflow

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
      - run: npx -y ai-code-reviewer@latest review-pr
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 2. Add your API key

The default provider is OpenAI. Add the secret to your repo: **Settings → Secrets and variables → Actions → New repository secret**

- Name: `OPENAI_API_KEY`
- Value: your key from [platform.openai.com](https://platform.openai.com)

To use a different provider (Anthropic, Gemini, Ollama), see the [Providers](#providers) section.

(`GITHUB_TOKEN` is provided automatically by GitHub.)

### 3. (Optional) Configure project rules

```bash
npx @giolabsuy/ai-code-reviewer init
```

This creates `.ai-review.yml` with all defaults documented. Edit to your liking.

### 4. Open a PR

The next PR you open triggers the workflow. The bot leaves inline comments on lines with findings and a general summary.

---

## Providers

The reviewer supports four providers. Configure your preferred one in `.ai-review.yml`:

```yaml
provider: openai   # openai | anthropic | gemini | ollama
model: gpt-4o-mini # provider-specific model
```

| Provider | GitHub Secret | Default model | Console |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com) |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | [console.anthropic.com](https://console.anthropic.com) |
| Gemini | `GEMINI_API_KEY` | `gemini-1.5-flash` | [aistudio.google.com](https://aistudio.google.com) |
| Ollama | _(no key — self-hosted)_ | set via `model:` | [ollama.com](https://ollama.com) |

For Anthropic, Gemini, and Ollama the GitHub Actions workflow is identical to OpenAI — only the secret name and `provider` in the config change:

```yaml
- run: npx -y ai-code-reviewer@latest review-pr
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Ollama** runs locally and needs no API key, but requires the service to be running and the URL configured in `.ai-review.yml`:

```yaml
provider: ollama
model: codellama
ollamaUrl: http://localhost:11434   # default if omitted
```

---

## Configuration

The `.ai-review.yml` (or `.ai-review.json`) file at the root of your repo controls behavior. Here are all options with their defaults:

```yaml
# LLM provider: openai | anthropic | gemini | ollama
provider: openai

# Provider model. See the Providers section for options per provider.
model: gpt-4o-mini

# Review language: es | en
language: es

# Tech stack. Omit to auto-detect from package.json
# tech: nestjs

# Additional custom rules (markdown). Appended to the system prompt.
# rules: ./code-review-rules.md

# File globs to ignore
ignore:
  - node_modules/**
  - dist/**
  - "*.lock"
  - "*.min.js"

# Minimum severity: critical | major | minor | info | nitpick
minSeverity: minor

# Maximum patch size per file (bytes)
maxFileSize: 100000

# Enabled check categories
checks:
  security: true
  performance: true
  maintainability: true
  testing: true
  documentation: false
  style: false
  bug-risk: true
  architecture: true

# Posting behavior
inlineComments: true
summaryComment: true
maxInlineComments: 20

# Extra prompt appended to the system prompt
customInstructions: |
  This project follows Clean Architecture. Any import from the domain
  layer into infrastructure is a 'major' finding.
```

### Extended custom rules

For longer rules, keep them in a separate file and reference it:

```yaml
rules: ./code-review-rules.md
```

That markdown is appended to the full system prompt. Useful for listing team conventions, required/forbidden patterns, and accepted exceptions.

See `examples/code-review-rules.md` for a template.

---

## Supported tech stacks (built-in)

The reviewer automatically loads a rule set based on the detected stack. Currently detectable:

| Stack | Detection |
|---|---|
| **NestJS** | `@nestjs/core` in `package.json` |
| **Next.js** | `next` in `package.json` |
| **React** | `react` in `package.json` |
| **TypeScript** | `typescript` in `package.json` |
| **Node** | `package.json` without the above |
| **Flutter** | `pubspec.yaml` |
| **Laravel** | `composer.json` |
| **Generic** | Fallback |

Built-in rules live in [`templates/`](./templates) and can be inspected in the repo. If your custom rules conflict with a built-in one, yours win.

---

## CLI commands

### `review-pr`

Main mode: runs inside GitHub Actions on the current PR.

```bash
npx @giolabsuy/ai-code-reviewer review-pr [options]
```

Detects the PR from `GITHUB_EVENT_PATH`, fetches changed files via API, calls the configured LLM, and posts the review with summary + inline comments.

In JS/TS stacks, `review-pr` automatically analyzes the 1-level dependency graph of the changed files — what they import and what imports them — and injects it into the LLM context. This lets the model detect anticipated bugs and regression risks in callers that aren't part of the diff.

The result includes two additional sections in the PR summary (when non-empty):
- **🐛 Anticipated Bugs** — bugs likely to surface in the future given the change.
- **⚠️ Regression Risks** — caller files that may break.

**Options:**
- `--dry-run` — does not post to the PR, only prints the result.
- `--save <path>` — saves a markdown report at the given path.
- `-c, --config <path>` — alternate config.
- `-r, --rules <path>` — alternate custom rules.
- `-m, --model <model>` — model override.
- `-l, --language <es|en>` — language override.
- `-t, --tech <stack>` — force tech stack.

**Exit codes:**
- `0` — review posted, recommendation is `approve` or `comment`.
- `1` — review posted with recommendation `request_changes`, or error.

### `review-file <file>`

Reviews a local file without touching git or a PR. Useful for iterating on rules.

```bash
npx @giolabsuy/ai-code-reviewer review-file src/users/users.service.ts
```

### `review-diff`

Reviews the output of `git diff` locally.

```bash
# Working tree vs HEAD
npx @giolabsuy/ai-code-reviewer review-diff

# Staged only
npx @giolabsuy/ai-code-reviewer review-diff --staged

# Against a base branch
npx @giolabsuy/ai-code-reviewer review-diff --base main
```

Useful as a pre-commit hook or sanity check before pushing.

### `init`

Creates `.ai-review.yml` with all defaults documented.

```bash
npx @giolabsuy/ai-code-reviewer init
```

---

## Local usage

To run the reviewer locally you need the API key for the provider you're using. The easiest way is a `.env` at the root:

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
# ANTHROPIC_API_KEY=sk-ant-...

# Gemini
# GEMINI_API_KEY=AI...
```

`dotenv` loads it automatically. For Ollama no key is needed — just have the service running at `http://localhost:11434` (or the URL you configure in `ollamaUrl`).

```bash
npx @giolabsuy/ai-code-reviewer review-file src/some-file.ts
```

---

## Design decisions

**Why a CLI that runs in Actions and not a GitHub App?**
Apps require your own infrastructure (server, webhooks, token management). A CLI via `npx` runs on the client's runner, requires no infra to maintain, and the bot's code is fully auditable by the team using it.

**Why multi-provider?**
Different teams have different contracts, privacy preferences, and budgets. OpenAI is the default because it has the best quality-to-cost ratio for code review today, but Anthropic, Gemini, and Ollama are valid alternatives. The CLI abstracts the provider behind a common interface: switching providers is a field in `.ai-review.yml` and a secret in the repo, without touching the workflow.

**Why never auto-approve?**
Even if the model returns `approve` in its recommendation, the review is posted as `COMMENT` or `REQUEST_CHANGES`. Approving PRs remains a human decision.

**Why inline comments + summary and not just one big comment?**
Inline comments appear at the relevant spot in the PR, which greatly reduces the friction of understanding what the bot is flagging. The summary covers findings that don't map to lines in the diff.

---

## Known limitations

- **Only `pull_request` / `pull_request_target` events.** Direct `push` to a branch is not supported.
- **Giant diffs are truncated.** PRs with thousands of changed lines may not fit in the context window; the model will only see part of it. Aim for small PRs (your human reviewer will thank you too).
- **Inline comments only on diff lines.** GitHub does not allow commenting on untouched lines. Findings about lines outside the diff fall back to the summary.
- **No memory between PRs.** Each review is independent.

---

## Development

```bash
git clone https://github.com/giolabs/ai-code-reviewer
cd ai-code-reviewer
npm install
npm run build
```

To test without publishing:

```bash
# In the reviewer repo
npm link

# In the target repo
npm link @giolabsuy/ai-code-reviewer
ai-code-reviewer review-file src/some-file.ts
```

---

## License

MIT
