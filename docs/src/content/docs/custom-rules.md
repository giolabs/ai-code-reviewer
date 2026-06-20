---
title: Custom Rules
description: Write project-specific review rules that override built-in templates.
---

The reviewer ships with built-in rules per tech stack, but every project has its own conventions. Two mechanisms let you teach the reviewer about yours.

## Option 1 — `code-review-rules.md`

Create a Markdown file in your repo and reference it from `.ai-review.yml`:

```yaml
rules: ./code-review-rules.md
```

The file's content is appended to the system prompt after the built-in template. **Your rules override built-in ones on conflict** — the LLM sees them last and treats them as authoritative.

### Structure

Write rules as imperative statements grouped by concern. Each rule should say what to flag and at what severity.

```markdown
## Architecture

- Never import from `src/infrastructure/` inside `src/domain/` → major.
- Business logic must live in services, not controllers → major.

## Security

- All endpoints must use `@UseGuards(JwtAuthGuard)` unless decorated with `@Public()` → major.
- Never access `process.env` outside `src/config/` → minor.

## Accepted exceptions

The reviewer must NOT flag:
- `as any` in test files — accepted trade-off.
- `process.env` inside `*.config.ts` files — that is the designated config boundary.
```

### Example

The repo includes a ready-to-use template at [`examples/code-review-rules.md`](https://github.com/giolabs/ai-code-reviewer/blob/main/examples/code-review-rules.md) for a TypeScript/NestJS project. Copy it to your repo and adapt it.

### Tips for effective rules

- **Be imperative and specific.** "Never import X from Y → severity" outperforms "avoid coupling".
- **Name the severity.** `critical` / `major` / `minor` / `info` / `nitpick`. Without a severity, the model guesses.
- **Add an exceptions section.** Explicitly list what NOT to flag to prevent false positives.
- **Keep it under 150 lines.** Longer files push the diff out of the context window.

---

## Option 2 — `customInstructions`

For short, inline instructions that don't warrant a separate file:

```yaml
# .ai-review.yml
customInstructions: |
  This project uses Clean Architecture. Domain layer must never import from infrastructure.
  File names must be kebab-case. Class names must be PascalCase.
  The `Logger` class from NestJS is the only allowed logging mechanism.
```

`customInstructions` is appended after `rules` (if both are set), so it has the highest priority.

---

## Severity scale

| Severity | When to use |
|---|---|
| `critical` | Security vulnerability, data loss, will break in production |
| `major` | Significant bug risk, architecture violation, missing validation |
| `minor` | Code quality issue, missing test, bad pattern |
| `info` | Observation or suggestion, no action required |
| `nitpick` | Style preference, very low priority |

Use `minSeverity: major` in `.ai-review.yml` to filter out noise in early-stage projects.

---

## Check categories

Toggle categories on or off to focus the review:

```yaml
checks:
  security: true
  performance: true
  maintainability: true
  testing: true
  documentation: false  # off by default — defer to your linter/formatter
  style: false
  bug-risk: true
  architecture: true
```

Disabling a category removes it from the system prompt — the model won't look for those issues at all, which reduces false positives and keeps the context focused.
