# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

All code must be written in **English** without exception: class names, method names, variable names, interface names, enum values, type aliases, file names, inline comments, and commit messages. The only content permitted in Spanish is user-facing CLI output and the README, which are intentionally in Spanish (rioplatense) for end users.

## Spec First

Before implementing any new feature or significant change, always generate a spec using `/generate-spec`. The resulting spec file must be saved under `docs/` with a descriptive kebab-case name (e.g., `docs/inline-comment-grouping.md`). No implementation starts until the spec exists and has been reviewed.

## What This Is

AI-powered code reviewer CLI for GitHub PRs. Runs as a GitHub Actions step via `npx ai-code-reviewer@latest review-pr`, or locally via `review-file` and `review-diff` commands. Uses OpenAI structured output (`response_format: json_schema`) to produce typed review results. Written in Spanish (rioplatense) — README, comments, CLI output, and the default review language are all in Spanish.

## Build & Run

```bash
npm install
npm run build          # tsc → dist/
npm run dev            # tsx src/cli.ts (no compile step)
npm run clean          # rm -rf dist
```

There are no tests. There is no linter configured.

To test locally, set `OPENAI_API_KEY` in a `.env` file or environment, then:

```bash
npm run dev -- review-file src/some-file.ts
npm run dev -- review-diff --staged
npm run dev -- review-diff --base main
npm run dev -- review-pr --dry-run   # only works in GitHub Actions context
```

## Architecture

The pipeline is: **CLI → config resolution → tech detection → prompt assembly → OpenAI call → output/post**.

### Source files (`src/`)

- **cli.ts** — Commander-based CLI entry point. Defines `review-pr`, `review-file`, `review-diff`, and `init` commands. Also contains the `EXAMPLE_CONFIG` template string for `init`.
- **reviewer.ts** — Orchestrator. Each command (`reviewPullRequest`, `reviewSingleFile`, `reviewLocalDiff`) follows the same flow: resolve config → detect tech → build prompts → call OpenAI → filter/format output. Contains `parseLocalDiff()` for parsing raw `git diff` output into `ChangedFile[]`.
- **config.ts** — Loads `.ai-review.yml` (or `.json` variants) merged over `DEFAULT_CONFIG`. Also loads built-in tech templates from `templates/` and user-provided rules markdown. Contains the glob-matching implementation for ignore patterns.
- **tech-detect.ts** — Detects project tech stack from `package.json` deps or marker files (`pubspec.yaml`, `composer.json`). Order matters: more specific stacks first (Next.js before React, NestJS before Node).
- **prompts.ts** — Builds the system prompt (role, tech rules, check categories, severity scale, language) and user prompt (PR metadata + file diffs with truncation at 80k chars).
- **openai.ts** — Thin wrapper around `OpenAI.chat.completions.create` with `json_schema` response format. The `REVIEW_SCHEMA` constant defines the strict JSON schema the model must follow. Returns typed `ReviewResult`.
- **github.ts** — Octokit-based GitHub API integration: reads PR context from `GITHUB_EVENT_PATH` env vars, fetches changed files, posts reviews with inline comments. `buildDiffLineMap()` parses unified diffs to determine which lines are commentable. `postReview()` splits findings into inline comments (on diff lines) vs orphans (appended to summary).
- **output.ts** — Terminal pretty-printing with chalk and markdown report generation. Severity filtering and sorting logic lives here.
- **types.ts** — All shared types: `Severity`, `CheckCategory`, `TechStack`, `ReviewerConfig`, `ReviewFinding`, `ReviewResult`, `ChangedFile`, `PullRequestContext`.

### Key design decisions

- **Never auto-approves**: `mapRecommendationToEvent()` in `reviewer.ts` downgrades `approve` → `COMMENT`. Human approval only.
- **Structured output over parsing**: Uses OpenAI's `json_schema` response format so the model is constrained to valid output — no regex/string parsing of LLM responses.
- **Custom rules override built-in**: User's `code-review-rules.md` is appended after built-in tech template in the system prompt, so it wins on conflicts.
- **Exit code 1 on `request_changes`**: Allows CI pipelines to fail the job when the reviewer flags serious issues.

### Templates (`templates/`)

Markdown files with review rules per tech stack: `nestjs-rules.md`, `nextjs-rules.md`, `react-rules.md`, `typescript-rules.md`, `node-rules.md`, `flutter-rules.md`, `laravel-rules.md`, `generic-rules.md`. Loaded by `config.ts:loadBuiltinTemplate()`.

## Environment Variables

- `OPENAI_API_KEY` — Required for all review commands.
- `GITHUB_TOKEN` — Required for `review-pr` (provided automatically by GitHub Actions).
- `GITHUB_REPOSITORY`, `GITHUB_EVENT_PATH` — Read by `github.ts` to detect PR context in Actions.
- `DEBUG` — When set, prints full stack traces on error.

## ESM Module

This is an ESM package (`"type": "module"`). All internal imports use `.js` extensions (even for `.ts` source files). TypeScript is configured with `moduleResolution: "Bundler"` and target `ES2022`.

## TypeScript Coding Standards

These rules are mandatory and apply to every file written or modified in this project. No exceptions.

### Absolute prohibitions

- **No `any` or `unknown`**: Never use `any` or `unknown` as a variable type, parameter, return type, or generic. If the type is unknown, create a `Type`, `Interface`, or `enum` that models it explicitly. If it comes from an external API or untyped library, create a wrapper type that describes the expected shape.
- **No separate function parameters**: No function or method may receive separate positional parameters. All parameters are grouped into a single typed object declared with an explicit `interface`. Exception: simple single-primitive-argument callbacks (`id: string`, `index: number`) when the context makes it unambiguous.
- **No standalone functions**: Do not declare `function foo()` or `const foo = () => {}` at module scope. All logic lives inside a class. The only exceptions are React/framework hooks (named with the `use` prefix) and CLI entry points (the minimal `main` that instantiates the class and calls it).

### Typing

- **Always classes**: Every unit of logic is a class. Use `class` instead of object literals with methods or function modules.
- **`Partial<T>` for partial validation**: When a method or constructor accepts an optional subset of an interface's properties, use `Partial<T>` or `Partial<T> & Pick<T, 'field'>` instead of repeating optional properties manually.
- **`Readonly<T>` for immutable data**: Properties that are not modified after construction must be declared `readonly`. Arrays that are not mutated are `ReadonlyArray<T>`.
- **Explicit return types**: Every class method must explicitly declare its return type. Do not rely on inference for a method's public signature.
- **Constrained generics**: Never `<T>` without a constraint when the type has a known shape. Use `<T extends MyInterface>` to narrow the contract.
- **Union types over control booleans**: Instead of `isActive: boolean`, model states with a union: `status: 'active' | 'inactive' | 'pending'`. When the domain grows, promote to `enum`.
- **`enum` for closed sets of values**: Related constant values that represent a domain (severities, statuses, categories) must be `enum`, not scattered string literals.
- **`interface` for contracts, `type` for aliases and unions**: Use `interface` when defining the shape of an object that can be implemented or extended. Use `type` for union aliases, intersections, or utility types.
- **No `as X` type assertions except in test setup or guards**: The `as Type` cast masks errors. If needed, it is a signal that the source type is modelled incorrectly — refactor the source. The only permitted exceptions are narrowing type guards (`as never` in exhaustive checks) and test fixtures.

### Code structure

- **One class per file**: Each file exports a single main class. Auxiliary types, interfaces, and enums for that file may coexist in the same file.
- **Constructor dependency injection**: A class's dependencies are received via the constructor and stored as `private readonly`. Do not instantiate dependencies inside methods.
- **Small, intention-named methods**: A method does one thing. If it exceeds ~20 lines, extract logic into private methods with names that describe the intention.
- **No parameter mutation**: Received parameters are not modified. If transformation is needed, create a new variable with the result.
- **`async/await` over callbacks and `.then()`**: All asynchrony uses `async/await`. Errors are handled with typed `try/catch` (the `catch (e)` block must cast to a concrete type or use a guard — never leave `e` as `unknown` without narrowing).

### Correct pattern example (typing)

```typescript
// ✅ Correct
interface ReviewOptions {
  filePath: string;
  maxTokens: number;
  language?: string;
}

interface ReviewOutput {
  findings: ReviewFinding[];
  recommendation: Recommendation;
}

class FileReviewer {
  constructor(
    private readonly openaiClient: OpenAIClient,
    private readonly config: ReviewerConfig,
  ) {}

  async review(options: ReviewOptions): Promise<ReviewOutput> {
    const prompt = this.buildPrompt(options);
    return this.openaiClient.call(prompt);
  }

  private buildPrompt(options: ReviewOptions): string {
    // ...
  }
}

// ❌ Incorrect — none of these patterns are allowed
function reviewFile(path: string, tokens: number, lang?: string): any { }
const process = (data: unknown) => { };
class Foo { bar(a: string, b: number, c: boolean) { } }
```

## Testing with Vitest

### Setup

Use **Vitest** as the sole testing framework. Configure it in `vitest.config.ts` at the root. Install with `npm install -D vitest`.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

Add scripts to `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

### Testing rules

**Mandatory AAA pattern**: Every test follows exactly three commented blocks: `// Arrange`, `// Act`, `// Assert`. No exceptions. If a test does not have all three blocks clearly separated, it is poorly structured.

**Short files**: One test file covers one class. If the file exceeds ~100 lines, it is doing too much — split by responsibility or extract helpers. Never group tests for multiple classes in the same file.

**Meaningful test cases**: Each `it()` tests an observable domain behaviour, not an implementation detail. The test name completes the sentence: *"should [do something concrete] when [condition]"*. If the name does not describe a business scenario, the test adds no value.

**No complexity inside the test**: Zero conditional logic (`if`, `switch`, loops) inside an `it()`. If inputs need to vary, use `it.each()`. If setup is complex, move it to `beforeEach` or a local factory function in the file.

**Minimal, explicit mocks**: Mock only what crosses a real boundary (network, disk, external API). Do not mock domain classes you own — instantiate them directly. Mocks are declared with `vi.fn()` typed against the real interface: `vi.fn<MyInterface['method']>()`.

**One conceptual assertion per test**: An `it()` verifies one thing. Multiple `expect()` calls are allowed only when they all verify facets of the same result (e.g., an object with several fields). If each `expect()` verifies something different, split into separate tests.

**No shared global setup across describes**: Shared state between tests creates order-dependence and brittle tests. Use `beforeEach` inside the relevant `describe`, never mutable variables at module scope.

### File structure

Tests **never** go alongside implementation files. Always in a `__test__` folder at the project root, mirroring the structure of `src/`.

```
src/
  reviewer.ts
  config.ts
  github.ts
__test__/
  reviewer.test.ts
  config.test.ts
  github.test.ts
```

Update `vitest.config.ts` to point to that folder:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__test__/**/*.test.ts'],
  },
});
```

### Correct pattern example (testing)

```typescript
// reviewer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileReviewer } from './reviewer.js';

// Local factory — hides the noise of object construction
function makeReviewer(overrides: Partial<ReviewerConfig> = {}): FileReviewer {
  const config: ReviewerConfig = { language: 'es', maxTokens: 1000, ...overrides };
  const openaiClient = { call: vi.fn<OpenAIClient['call']>() };
  return new FileReviewer(openaiClient, config);
}

describe('FileReviewer', () => {
  describe('review', () => {
    it('should return findings when the model detects problems', async () => {
      // Arrange
      const reviewer = makeReviewer();
      const expectedFindings: ReviewFinding[] = [
        { severity: Severity.HIGH, message: 'Untyped variable', file: 'foo.ts', line: 3 },
      ];
      vi.mocked(reviewer['openaiClient'].call).mockResolvedValueOnce({
        findings: expectedFindings,
        recommendation: 'request_changes',
      });

      // Act
      const result = await reviewer.review({ filePath: 'foo.ts', maxTokens: 1000 });

      // Assert
      expect(result.findings).toEqual(expectedFindings);
    });

    it('should return an empty list when there are no problems', async () => {
      // Arrange
      const reviewer = makeReviewer();
      vi.mocked(reviewer['openaiClient'].call).mockResolvedValueOnce({
        findings: [],
        recommendation: 'comment',
      });

      // Act
      const result = await reviewer.review({ filePath: 'clean.ts', maxTokens: 1000 });

      // Assert
      expect(result.findings).toHaveLength(0);
    });
  });
});

// ❌ Incorrect — these patterns are not allowed
it('test 1', () => {
  const r = new FileReviewer(x, y);
  if (condition) { expect(r.foo()).toBe(1); } // logic inside the test
});

it('verifies everything', async () => {
  expect(result.a).toBe(1);  // mixed asserts — split into separate tests
  expect(result.b).toBe(2);
  expect(result.c).toBe(3);
});
```
