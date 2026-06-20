---
title: Tech Stacks
description: Auto-detected stacks and their built-in review rules.
---

The reviewer auto-detects your tech stack from `package.json`, `pubspec.yaml`, or `composer.json` and loads a built-in set of review rules for it. You can override detection with `tech:` in `.ai-review.yml`.

## Detection order

More specific stacks are checked first to avoid false positives:

| Stack | Detection signal |
|---|---|
| **NestJS** | `@nestjs/core` in `package.json` |
| **Next.js** | `next` in `package.json` |
| **React** | `react` in `package.json` |
| **TypeScript** | `typescript` in `package.json` |
| **Node** | `package.json` without the above |
| **Flutter** | `pubspec.yaml` present |
| **Laravel** | `composer.json` present |
| **Generic** | Fallback — no signal found |

## Built-in rules per stack

Each stack ships with a focused rule set. Here are the key checks. For the full lists, see the [`templates/` directory](https://github.com/giolabs/ai-code-reviewer/tree/main/templates) in the repo.

### NestJS

- Business logic in controllers → `major` (must be in services/use-cases)
- DTOs without `class-validator` decorators on public endpoints → `major`
- Direct repository access from a controller → `major`
- Endpoints missing `@UseGuards()` on non-public routes → `major`
- N+1 via lazy relations in loops → `major`
- Raw SQL with string interpolation → `critical`
- `console.log` in production code → `minor` (use Nest's `Logger`)

### Next.js

- Hooks (`useState`, `useEffect`) in Server Components without `use client` → `critical`
- `NEXT_PUBLIC_` prefix on sensitive env vars → `critical`
- `useEffect` for initial data fetch when a Server Component is available → `major`
- Missing `Link` component for internal navigation → `minor`
- Images not using `next/image` → `minor`

### React

- Broken hook rules (inside conditionals/loops) → `critical`
- Components mutating props or state outside a setter → `critical`
- Raw HTML injection with unsanitized content → `critical`
- `useEffect` with missing or incorrect dependency array → `major`
- Lists without a stable `key` prop → `bug-risk`
- Buttons as `div onClick` instead of `button` → `minor`

### TypeScript

- `any` in domain code → `major`; in tests → allowed
- `as any` or `as unknown as X` → `major`
- Non-null assertion `!` without an obvious guarantee → `bug-risk`
- Missing explicit return types on public methods → `minor`
- Circular imports → `major`
- Code that only compiles with `strict: false` → `major`

### Node.js

- Sync filesystem operations in request handlers → `major`
- Unhandled promise rejections → `major`
- `path.join` with user-supplied segments without validation → `critical` (path traversal)
- No payload limit on body parser → `major`
- Dynamic `require`/`import` with user-provided strings → `critical`

### Flutter

- `BuildContext` used after `await` without a `mounted` check → `bug-risk`
- `StreamController`/`AnimationController` without `dispose` → `bug-risk`
- `ListView` without `itemBuilder` for long lists → `major`
- Assets not declared in `pubspec.yaml` → `critical`
- Missing `const` on static widgets → `nitpick`

### Laravel

- N+1 queries (loop accessing relations without `with()`) → `major`
- Unsafe HTML rendering with unsanitized user input → `critical`
- `Model::all()` on large tables → `major`
- Routes missing `auth` middleware on protected routes → `major`
- Raw queries with user input → `critical`

### Generic

Applied as a baseline to all stacks (layered under the stack-specific rules):

- Hardcoded secrets → `critical`
- SQL/command injection, path traversal → `critical`
- Silenced `catch {}` blocks without justification → `bug-risk`
- Functions over ~50 lines or 5+ parameters → `minor`
- Magic numbers/strings without named constants → `minor`

## Custom rules override built-in ones

If your `code-review-rules.md` defines a rule that conflicts with a built-in one, yours wins. The built-in template is injected first, and your file is appended after — the LLM sees your rules last and treats them as the authoritative constraint.

See [Custom Rules](./custom-rules) to learn how to write your own.
