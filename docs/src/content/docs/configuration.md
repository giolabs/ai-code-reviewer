---
title: Configuration
description: Full reference for .ai-review.yml — all options, defaults, and examples.
---

The `.ai-review.yml` (or `.ai-review.json`) file at the root of your repo controls reviewer behavior. All fields are optional — omit any field to use the default.

Run `npx ai-code-reviewer init` to generate a pre-filled config file.

## Full reference

```yaml
# LLM provider: openai | anthropic | gemini | ollama
provider: openai

# Provider model. See Providers page for options per provider.
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

# Minimum severity to include in output: critical | major | minor | info | nitpick
minSeverity: minor

# Maximum patch size per file (bytes). Files larger than this are skipped.
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

# Ollama service URL (only relevant when provider: ollama)
# ollamaUrl: http://localhost:11434

# Extra instructions appended to the system prompt
customInstructions: |
  This project follows Clean Architecture. Any import from the domain
  layer into infrastructure is a 'major' finding.
```

## Field reference

### `provider`

Which LLM provider to use. See [Providers](./providers) for setup instructions per provider.

**Default:** `openai`  
**Options:** `openai` | `anthropic` | `gemini` | `ollama`

### `model`

The model name for the selected provider. Any model available on the provider's API is valid.

**Default:** `gpt-4o-mini` (when `provider: openai`)

### `language`

Language the reviewer uses for finding descriptions and the PR summary.

**Default:** `es`  
**Options:** `es` | `en`

### `tech`

Force a specific tech stack instead of auto-detecting. Useful when detection fails or when you want to apply a specific rule template.

**Default:** auto-detected from `package.json` / `pubspec.yaml` / `composer.json`  
**Options:** `nestjs` | `nextjs` | `react` | `typescript` | `node` | `flutter` | `laravel` | `generic`

### `rules`

Path to a custom rules Markdown file relative to the repo root. Content is appended to the system prompt after the built-in template. Your rules override built-in ones on conflict.

**Default:** none

### `ignore`

Array of glob patterns for files to exclude from review. Uses micromatch syntax.

**Default:** `["node_modules/**", "dist/**", "*.lock", "*.min.js"]`

### `minSeverity`

Only findings at this severity or higher are included in the output and posted to the PR.

**Default:** `minor`  
**Order (highest to lowest):** `critical` → `major` → `minor` → `info` → `nitpick`

### `maxFileSize`

Files with a patch larger than this number of bytes are skipped entirely.

**Default:** `100000` (100 KB)

### `checks`

Toggle individual check categories on or off.

| Category | Default | Description |
|---|---|---|
| `security` | `true` | Auth, injection, secrets, XSS |
| `performance` | `true` | N+1 queries, blocking ops, unnecessary renders |
| `maintainability` | `true` | Complexity, naming, duplication |
| `testing` | `true` | Missing tests, bad mocking, vague assertions |
| `documentation` | `false` | Missing docstrings, comments |
| `style` | `false` | Formatting, whitespace (defer to your linter) |
| `bug-risk` | `true` | Null safety, race conditions, off-by-one |
| `architecture` | `true` | Layer violations, coupling |

### `inlineComments`

Post findings as inline comments on the PR diff. Findings that don't map to a diff line go to the summary.

**Default:** `true`

### `maxInlineComments`

Cap on the number of inline comments per review. Additional findings go to the summary body.

**Default:** `20`

### `ollamaUrl`

The base URL for the Ollama service. Only used when `provider: ollama`.

**Default:** `http://localhost:11434`

### `customInstructions`

Free-form text appended verbatim to the system prompt after all other rules. Use this for project-specific conventions that don't fit in a separate rules file.

## Extended custom rules

For longer rule sets, keep them in a separate file and reference it:

```yaml
rules: ./code-review-rules.md
```

That Markdown is appended to the full system prompt. Useful for listing team conventions, required/forbidden patterns, and accepted exceptions.

See [Custom Rules](./custom-rules) for guidance on writing effective rules, and `examples/code-review-rules.md` in the repo for a ready-to-use template.
