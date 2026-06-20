# Unit Tests for Core Classes

> **Status:** DRAFT

## 1. Goal

Refactor the six logic-heavy source modules in `src/` from module-level functions into classes (as mandated by `CLAUDE.md`), then write Vitest unit tests covering ≥ 80% line coverage for each class. After this phase, the codebase is testable, CLAUDE.md-compliant, and every class has at least happy-path + error-path coverage verified by an automated test suite.

Files in scope for refactoring and testing: `src/config.ts`, `src/tech-detect.ts`, `src/prompts.ts`, `src/output.ts`, `src/rules.ts`, `src/llm/json-parser.ts`.

## 2. Scope

### Included in this phase

- Install Vitest and `@vitest/coverage-v8` as devDependencies
- Add `"test"` and `"test:watch"` scripts to `package.json`
- Create `vitest.config.ts` at the repo root
- Refactor the six in-scope source files into classes (one class per file, constructor DI, `private readonly` dependencies)
- Update all callers of the refactored files (`src/reviewer.ts`, `src/cli.ts`) to use the new class-based API
- Create `__test__/` folder at the repo root with one test file per class
- Write tests following the AAA pattern, one conceptual assertion per `it()`, no logic inside tests
- Achieve ≥ 80% line coverage across all six classes (measured via `vitest run --coverage`)

### Out of scope

- Testing `src/reviewer.ts` — orchestrator, deferred to a future phase
- Testing `src/github.ts` — requires heavy Octokit mocking, deferred
- Testing `src/cli.ts`, `src/action.ts` — CLI entry points, deferred
- Testing `src/llm/openai.ts`, `anthropic.ts`, `gemini.ts`, `ollama.ts`, `factory.ts` — LLM adapters with external API calls, deferred
- Integration tests or end-to-end tests
- Real OpenAI/GitHub API calls in any test
- CI configuration (GitHub Actions step for running tests)
- Mutation testing or 100% branch coverage

## 3. Technologies & Project Conventions

### Stack

- **Language:** TypeScript (ESM, `"type": "module"`)
- **Runtime:** Node.js >= 18
- **Test runner:** Vitest
- **Coverage provider:** `@vitest/coverage-v8`
- **Build tool:** `tsc` (TypeScript compiler)
- **Module resolution:** Bundler (`tsconfig.json`)

### Relevant versions

| Dependency | Version | Source |
|---|---|---|
| typescript | ^5.6.0 | `package.json` |
| node | >= 18.0.0 | `package.json` engines |
| vitest | ^3.0.0 | to be installed — `package.json` devDependencies |
| @vitest/coverage-v8 | ^3.0.0 | to be installed — `package.json` devDependencies |

### Existing patterns to follow

- ESM imports use `.js` extension even for `.ts` source files — all imports in test files must use `.js` extensions
- CLAUDE.md TypeScript rules apply in full: no `any`/`unknown`, all parameters as typed interface objects, explicit return types, `Readonly<T>` for immutable data
- CLAUDE.md testing rules: AAA pattern, one class per test file (~100 lines max), one conceptual assertion per `it()`, no `if`/`for` inside `it()`, mock only at real boundaries
- Test files mirror `src/` structure under `__test__/` — `src/config.ts` → `__test__/config.test.ts`; `src/llm/json-parser.ts` → `__test__/llm/json-parser.test.ts`

## 4. Prerequisites

- [x] All six source files exist and build cleanly (`npm run build` passes)
- [x] `src/types.ts` exports `ReviewerConfig`, `ReviewFinding`, `ReviewResult`, `ChangedFile`, `Severity`, `CheckCategory`, `TechStack` (confirmed)
- [x] No existing test infrastructure (no `vitest`, no `__test__/`, no `vitest.config.ts`)
- [x] `node_modules/` excluded from git (`.gitignore` now in place)
- [ ] Vitest `^3.0.0` and `@vitest/coverage-v8 ^3.0.0` installed as devDependencies before any test file is written

## 5. Architecture

### Pattern

Pure dependency injection — each class receives its dependencies via the constructor and stores them as `private readonly`. Test files instantiate the class directly and mock only external boundaries (filesystem via `vi.spyOn(fs, 'readFileSync')` / `vi.spyOn(fs, 'existsSync')`, or by writing to a real temp dir).

### Layers affected

| Layer | Affected? | Description |
|---|---|---|
| Source classes (`src/`) | **Yes** | Six files refactored to classes |
| Callers (`src/reviewer.ts`, `src/cli.ts`) | **Yes** | Updated to use class instantiation |
| Test layer (`__test__/`) | **Yes** | New folder with 6 test files created |
| Build config (`vitest.config.ts`, `package.json`) | **Yes** | Vitest configured |
| Types (`src/types.ts`) | No | No changes |
| LLM adapters (`src/llm/`) | No | Only `json-parser.ts` is in scope |
| GitHub integration (`src/github.ts`) | No | Deferred |

### Class designs

#### `ConfigLoader` (replaces `src/config.ts` module functions)

```typescript
interface ConfigLoaderOptions {
  cwd?: string;
}

class ConfigLoader {
  constructor(private readonly options: ConfigLoaderOptions = {}) {}

  findConfigFile(explicitPath?: string): string | null { ... }
  loadConfig(explicitPath?: string): ReviewerConfig { ... }
  loadRulesFile(rulesPath: string | undefined): string | null { ... }
  loadBuiltinTemplate(tech: string): string | null { ... }

  // Pure helpers — may remain as static methods or private helpers
  static matchesPattern(path: string, pattern: string): boolean { ... }
  static filterIgnored(paths: ReadonlyArray<string>, ignorePatterns: ReadonlyArray<string>): string[] { ... }
}
```

All methods that previously accepted a `cwd` parameter must read it from `this.options.cwd ?? process.cwd()` instead — the `cwd` parameter is removed from all method signatures after refactoring.

`DEFAULT_CONFIG` remains as a module-level exported `const` (data, not logic). `CONFIG_FILENAMES` is currently unexported — the refactor must export it (`export const CONFIG_FILENAMES`) so tests and callers can reference it if needed.

#### `TechDetector` (replaces `src/tech-detect.ts`)

```typescript
interface TechDetectorOptions {
  cwd?: string;
}

class TechDetector {
  constructor(private readonly options: TechDetectorOptions = {}) {}

  detect(): TechStack { ... }
  static displayName(tech: TechStack): string { ... }
}
```

#### `PromptBuilder` (replaces `src/prompts.ts`)

```typescript
interface SystemPromptArgs {
  config: ReviewerConfig;
  tech: TechStack;
  mergedRulesText: string;
}

interface UserPromptArgs {
  files: ReadonlyArray<ChangedFile>;
  prTitle?: string;
  prBody?: string | null;
  maxTotalChars?: number;
}

class PromptBuilder {
  constructor() {}   // no dependencies — pure string building

  buildSystemPrompt(args: SystemPromptArgs): string { ... }
  buildUserPrompt(args: UserPromptArgs): string { ... }
}
```

Note: `buildSystemPrompt` calls `techDisplayName(tech)` internally. After refactoring `TechDetector`, `techDisplayName` must remain accessible — either as a static method `TechDetector.displayName(tech)` or as a re-exported pure function from `src/tech-detect.ts`. `PromptBuilder` does NOT take a `TechDetector` instance as a dependency — it resolves the display name via the static export directly.

#### `OutputFormatter` (replaces `src/output.ts`)

```typescript
class OutputFormatter {
  constructor() {}   // no dependencies — pure formatting

  sortFindings(findings: ReadonlyArray<ReviewFinding>): ReviewFinding[] { ... }
  filterBySeverity(findings: ReadonlyArray<ReviewFinding>, minSeverity: Severity): ReviewFinding[] { ... }
  print(result: ReviewResult): void { ... }       // renamed from printReviewToTerminal
  toMarkdown(result: ReviewResult): string { ... } // renamed from reviewToMarkdown
}
```

**Renames:** `printReviewToTerminal` → `print`, `reviewToMarkdown` → `toMarkdown`. All callers in `src/reviewer.ts` must be updated to use the new method names when calling the class instance.

#### `RulesLoader` (replaces `src/rules.ts`)

```typescript
interface RulesLoaderDeps {
  configLoader: ConfigLoader;
}

interface LoadProjectRulesArgs {
  rulesPath: string | undefined;
  cwd: string;
}

interface MergeRulesArgs {
  project: CategoryRules;
  global: CategoryRules;
  enabledChecks: Record<CheckCategory, boolean>;
}

class RulesLoader {
  constructor(private readonly deps: RulesLoaderDeps) {}

  loadProjectRules(args: LoadProjectRulesArgs): CategoryRules { ... }
  loadGlobalRules(tech: TechStack): CategoryRules { ... }
  mergeRules(args: MergeRulesArgs): string { ... }
}
```

#### `ReviewJsonParser` (replaces `src/llm/json-parser.ts`)

```typescript
class ReviewJsonParser {
  constructor() {}   // no dependencies — pure parsing

  parse(raw: string): ReviewResult { ... }
}
```

### Expected flow (refactor + test)

1. Install Vitest and coverage provider
2. Create `vitest.config.ts`
3. Update `package.json` scripts
4. Refactor each source file into its class (one at a time, building after each)
5. Update `src/reviewer.ts` and `src/cli.ts` to instantiate and use the new classes
6. Run `npm run build` — must pass with zero errors
7. Create `__test__/` folder and write test files
8. Run `npm test` — all tests pass
9. Run `npm test -- --coverage` — ≥ 80% line coverage reported

### New file layout

```
/ (repo root)
  vitest.config.ts          ← NUEVO
  __test__/
    config.test.ts          ← NUEVO
    tech-detect.test.ts     ← NUEVO
    prompts.test.ts         ← NUEVO
    output.test.ts          ← NUEVO
    rules.test.ts           ← NUEVO
    llm/
      json-parser.test.ts   ← NUEVO
src/
  config.ts                 ← MODIFICAR (ConfigLoader class)
  tech-detect.ts            ← MODIFICAR (TechDetector class)
  prompts.ts                ← MODIFICAR (PromptBuilder class)
  output.ts                 ← MODIFICAR (OutputFormatter class)
  rules.ts                  ← MODIFICAR (RulesLoader class)
  reviewer.ts               ← MODIFICAR (use new classes)
  cli.ts                    ← MODIFICAR (use new classes)
  llm/
    json-parser.ts          ← MODIFICAR (ReviewJsonParser class)
package.json                ← MODIFICAR (add vitest scripts + devDeps)
```

## 6. Files to Create / Modify

| Path | Action | Purpose | Example to follow |
|---|---|---|---|
| `vitest.config.ts` | CREATE | Vitest configuration: globals, node environment, include pattern for `__test__/` | `tsconfig.json` (root config file pattern) |
| `package.json` | MODIFY | Add `vitest` + `@vitest/coverage-v8` devDependencies; add `"test"` and `"test:watch"` scripts | Existing `package.json` |
| `src/config.ts` | MODIFY | Wrap `findConfigFile`, `loadConfig`, `loadRulesFile`, `loadBuiltinTemplate` into `ConfigLoader` class; make `matchesPattern` and `filterIgnored` static methods | Current `src/config.ts` |
| `src/tech-detect.ts` | MODIFY | Wrap `detectTechStack` and `techDisplayName` into `TechDetector` class | Current `src/tech-detect.ts` |
| `src/prompts.ts` | MODIFY | Wrap `buildSystemPrompt` and `buildUserPrompt` into `PromptBuilder` class | Current `src/prompts.ts` |
| `src/output.ts` | MODIFY | Wrap all exported functions into `OutputFormatter` class | Current `src/output.ts` |
| `src/rules.ts` | MODIFY | Wrap functions into `RulesLoader` class; receive `ConfigLoader` via constructor | Current `src/rules.ts` |
| `src/llm/json-parser.ts` | MODIFY | Wrap `parseReviewJSON` into `ReviewJsonParser` class with `parse()` method | Current `src/llm/json-parser.ts` |
| `src/reviewer.ts` | MODIFY | Update all imports to use class instances; instantiate `ConfigLoader`, `TechDetector`, `PromptBuilder`, `OutputFormatter`, `RulesLoader`, `ReviewJsonParser` | Current `src/reviewer.ts` |
| `src/cli.ts` | MODIFY | Update imports from `src/config.ts` and `src/output.ts` to use class instances | Current `src/cli.ts` |
| `__test__/config.test.ts` | CREATE | Unit tests for `ConfigLoader` | CLAUDE.md testing example |
| `__test__/tech-detect.test.ts` | CREATE | Unit tests for `TechDetector` | CLAUDE.md testing example |
| `__test__/prompts.test.ts` | CREATE | Unit tests for `PromptBuilder` | CLAUDE.md testing example |
| `__test__/output.test.ts` | CREATE | Unit tests for `OutputFormatter` | CLAUDE.md testing example |
| `__test__/rules.test.ts` | CREATE | Unit tests for `RulesLoader` | CLAUDE.md testing example |
| `__test__/llm/json-parser.test.ts` | CREATE | Unit tests for `ReviewJsonParser` | CLAUDE.md testing example |

### Detail per file

#### `vitest.config.ts`

- **Responsibility:** Configure Vitest with `globals: true`, `environment: 'node'`, `include: ['__test__/**/*.test.ts']`, `coverage.provider: 'v8'`, `coverage.include: ['src/**']`, and `coverage.thresholds: { lines: 80 }` to enforce the ≥80% target automatically
- **Must NOT include:** `src/` in the test `include` pattern; any browser environment
- **Coverage `include` must be `['src/**']`** — without this, Vitest counts test files and config files in the coverage total, distorting the 80% metric

#### `src/config.ts` → `ConfigLoader`

- **Responsibility:** All config file discovery, YAML/JSON loading, rules file reading, template loading, and path glob matching
- **Must NOT include:** Any LLM calls, tech detection, or prompt logic
- **Constructor parameter:** `options: ConfigLoaderOptions` with optional `cwd` (defaults to `process.cwd()`)
- **Keep as module-level const:** `DEFAULT_CONFIG`, `CONFIG_FILENAMES`

#### `src/tech-detect.ts` → `TechDetector`

- **Responsibility:** Read `package.json` and marker files to return a `TechStack`; map `TechStack` to display name
- **Must NOT include:** Config loading or prompt building
- **Constructor parameter:** `options: TechDetectorOptions` with optional `cwd`

#### `src/prompts.ts` → `PromptBuilder`

- **Responsibility:** Assemble system and user prompts as strings; no side effects
- **Must NOT include:** Any filesystem reads, LLM calls, config loading
- **Constructor:** No parameters (pure)

#### `src/output.ts` → `OutputFormatter`

- **Responsibility:** Sort/filter findings, print to terminal with chalk, serialize to markdown
- **Must NOT include:** Config loading, LLM calls, file writes
- **Constructor:** No parameters (pure)

#### `src/rules.ts` → `RulesLoader`

- **Responsibility:** Load and merge project + global rules per category
- **Constructor parameter:** `deps: RulesLoaderDeps` containing a `ConfigLoader` instance
- **Must NOT include:** Prompt building, LLM calls, or direct `fs` calls (delegates to `ConfigLoader`)

#### `src/llm/json-parser.ts` → `ReviewJsonParser`

- **Responsibility:** Parse a raw LLM string response into a typed `ReviewResult` using three fallback strategies
- **Constructor:** No parameters (pure)
- **Must NOT include:** Any LLM API calls or network logic

#### `__test__/config.test.ts`

- **Responsibility:** Test `ConfigLoader` — config file discovery, YAML parsing, JSON parsing, glob matching, ignore filtering, missing file errors
- **Mocking strategy:** Write real temp files with `fs.writeFileSync` to `os.tmpdir()`, then use `ConfigLoader` with a custom `cwd` pointing to the temp dir (no mocking needed for pure file operations)
- **Must NOT include:** Tests for LLM or GitHub logic

**Scenarios to cover:**
- `loadConfig()` with no config file → returns `DEFAULT_CONFIG`
- `loadConfig()` with a valid `.ai-review.yml` → merges over defaults
- `loadConfig()` with a `.ai-review.json` → parses JSON correctly
- `loadConfig()` with an invalid explicit path → throws with `'Config file not found'`
- `matchesPattern()` — `node_modules/**` matches `node_modules/foo/bar`
- `matchesPattern()` — `*.lock` matches `yarn.lock`
- `matchesPattern()` — `src/foo.ts` does NOT match `node_modules/**`
- `filterIgnored()` — removes ignored paths, keeps non-ignored paths

#### `__test__/tech-detect.test.ts`

- **Mocking strategy:** Write real temp dirs with marker files (`package.json`, `pubspec.yaml`, `composer.json`) using `fs.mkdirSync` + `fs.writeFileSync`

**Scenarios to cover:**
- `detect()` → `'nextjs'` when `package.json` contains `next`
- `detect()` → `'nestjs'` when `package.json` contains `@nestjs/core`
- `detect()` → `'react'` when `package.json` contains `react` (but not `next`)
- `detect()` → `'flutter'` when `pubspec.yaml` exists
- `detect()` → `'laravel'` when `composer.json` exists
- `detect()` → `'generic'` when no `package.json` exists
- `detect()` → `'generic'` when `package.json` is malformed JSON
- `displayName('nestjs')` → `'NestJS'`

#### `__test__/prompts.test.ts`

- **Mocking strategy:** No mocks needed (pure string building)

**Scenarios to cover:**
- `buildSystemPrompt()` with `language: 'es'` → output contains rioplatense instruction
- `buildSystemPrompt()` with `language: 'en'` → output contains English instruction
- `buildSystemPrompt()` with `customInstructions` set → output contains those instructions
- `buildSystemPrompt()` with a disabled check → that check name does not appear in `enabledChecks`
- `buildUserPrompt()` with a PR title and body → output contains both
- `buildUserPrompt()` with a large diff → truncates at `maxTotalChars`
- `buildUserPrompt()` with `prTitle: undefined` → no `**PR title:**` line in output
- `buildUserPrompt()` with a file that has no patch → shows `no patch available`

#### `__test__/output.test.ts`

- **Mocking strategy:** `vi.spyOn(console, 'log').mockImplementation(() => {})` to suppress output

**Scenarios to cover:**
- `sortFindings()` — `critical` appears before `major`, same severity sorted by file then line
- `filterBySeverity()` — `minSeverity: 'major'` keeps `critical` and `major`, drops `minor`/`info`/`nitpick`
- `filterBySeverity()` — `minSeverity: 'nitpick'` keeps all severities
- `toMarkdown()` — output contains `## Findings` and the finding's title
- `toMarkdown()` — with zero findings, output contains the no-findings marker string (asserting the exact Spanish string `✅ Sin findings.` is acceptable here since `toMarkdown` is a serializer whose output schema is fixed, not user-facing copy that could change)
- `toMarkdown()` — with `tokensUsed` set, output contains the token count
- `print()` — calls `console.log` at least once

#### `__test__/rules.test.ts`

- **Mocking strategy:** Define a local `ConfigLoaderLike` interface with the methods `RulesLoader` actually calls (`loadRulesFile`, `loadBuiltinTemplate`), then mock them with `vi.fn<ConfigLoaderLike['loadRulesFile']>()`. Do NOT cast to `ConfigLoader` directly — use the interface so the mock stays type-safe without needing to implement the full class.

**Scenarios to cover:**
- `loadProjectRules()` — when `loadRulesFile` returns `null` → returns `{}`
- `loadProjectRules()` — parses `## security` section into `rules.security`
- `loadGlobalRules()` — when both template and generic fallback return `null` → returns `{}`
- `loadGlobalRules()` — calls `loadBuiltinTemplate('typescript')` for typescript stack
- `mergeRules()` — project rules override global rules for the same category
- `mergeRules()` — disabled check categories are excluded from output
- `mergeRules()` — general rules (`_general`) appear first in merged output

#### `__test__/llm/json-parser.test.ts`

- **Mocking strategy:** No mocks needed (pure parsing)

**Scenarios to cover:**
- `parse()` — valid JSON string → returns `ReviewResult`
- `parse()` — JSON wrapped in markdown code fence → returns `ReviewResult`
- `parse()` — JSON buried in surrounding text → extracts and returns `ReviewResult`
- `parse()` — completely invalid string → throws an error
- `parse()` — valid JSON missing required field `summary` → throws an error
- `parse()` — findings array is empty → `result.findings` is `[]`

## 7. API Contract

Not applicable — no network API surface involved.

## 8. Success Criteria

- [ ] `vitest.config.ts` exists at the repo root with correct configuration
- [ ] `package.json` has `"test": "vitest run"` and `"test:watch": "vitest"` scripts
- [ ] `package.json` devDependencies includes `vitest` and `@vitest/coverage-v8`
- [ ] All six source files export a named class (`ConfigLoader`, `TechDetector`, `PromptBuilder`, `OutputFormatter`, `RulesLoader`, `ReviewJsonParser`)
- [ ] `npm run build` passes with zero TypeScript errors after refactoring
- [ ] `npm test` passes with zero failing tests
- [ ] `npm test -- --coverage` passes the enforced threshold (`coverage.thresholds: { lines: 80 }` in `vitest.config.ts` causes the run to fail if any file drops below 80% line coverage)
- [ ] No `any` or `unknown` used anywhere in the refactored code or test files
- [ ] All `it()` tests follow AAA pattern with `// Arrange`, `// Act`, `// Assert` comments

### Tests required

| Test file | Scenarios |
|---|---|
| `__test__/config.test.ts` | 8 scenarios listed in section 6 (`ConfigLoader` detail) |
| `__test__/tech-detect.test.ts` | 8 scenarios listed in section 6 (`TechDetector` detail) |
| `__test__/prompts.test.ts` | 8 scenarios listed in section 6 (`PromptBuilder` detail) |
| `__test__/output.test.ts` | 7 scenarios listed in section 6 (`OutputFormatter` detail) |
| `__test__/rules.test.ts` | 7 scenarios listed in section 6 (`RulesLoader` detail) |
| `__test__/llm/json-parser.test.ts` | 6 scenarios listed in section 6 (`ReviewJsonParser` detail) |

### Verification commands

```bash
cd /Volumes/Giolabs-Project/Work/Projects/code-review-ai

# 1. TypeScript build must pass after refactoring
npm run build

# 2. All tests must pass
npm test

# 3. Coverage must be >= 80% line coverage
npm test -- --coverage

# 4. No TypeScript errors in test files
npx tsc --noEmit
```

## 9. UX Criteria

Not applicable — this is a backend library and CLI tool with no user interface.

## 10. Decisions Made (Locked)

| Decision | Why |
|---|---|
| Refactor first, then tests | Testing module-level functions and then rewriting to classes would make the tests immediately obsolete. One coherent pass produces a clean, durable result. |
| `cwd` injected via constructor options | Allows tests to pass a temp directory without patching `process.cwd()`. Eliminates the need to mock the Node.js process object. |
| Real filesystem for `ConfigLoader` and `TechDetector` tests | Filesystem access is not an "external API" boundary — it is a local, deterministic, fast operation. Mocking `fs` with `vi.spyOn` would be more brittle than writing real temp files. The CLAUDE.md testing rules confirm: "Mock only what crosses a real boundary (network, disk, external API)." Local disk temp files are acceptable. |
| Mock `ConfigLoader` in `RulesLoader` tests | `RulesLoader` depends on `ConfigLoader`. Testing through a real `ConfigLoader` would couple the two test files. Mocking `ConfigLoader` isolates the `RulesLoader` logic. |
| `vi.spyOn(console, 'log')` for `OutputFormatter` | `print()` calls `console.log` — the spy captures calls without suppressing color. No need to mock chalk. |
| `DEFAULT_CONFIG` and `CONFIG_FILENAMES` stay as module-level `const` | These are data declarations, not logic. CLAUDE.md's "no standalone functions" rule targets logic, not constants. |
| Vitest `^3.0.0`, `@vitest/coverage-v8 ^3.0.0` | Vitest 3 is the current stable release, supports ESM natively, and pairs with the existing TypeScript 5.6+ setup. |
| `parseRulesByCategory` becomes a private method | It is an internal implementation detail of `RulesLoader`. Exposing it would leak a private contract. |
| `RulesLoader.loadProjectRules()` and `mergeRules()` use typed interface args | CLAUDE.md prohibits separate positional parameters. `LoadProjectRulesArgs` and `MergeRulesArgs` interfaces are introduced to comply. All callers in `src/reviewer.ts` must be updated to pass object literals. |
| `techDisplayName` stays as a static method on `TechDetector` | `PromptBuilder` needs it but should not depend on a `TechDetector` instance. Keeping it as `TechDetector.displayName(tech)` (static) avoids a spurious constructor dependency. |

## 11. Edge Cases

### Invalid inputs

- `ConfigLoader.loadConfig()` with an explicit path that does not exist → throws `Error('Config file not found: <path>')`
- `ConfigLoader.loadRulesFile()` with a path that does not exist → throws `Error('Rules file not found: <path>')`
- `TechDetector.detect()` with a malformed `package.json` → returns `'generic'` (swallows parse error)
- `ReviewJsonParser.parse()` with an empty string → throws (no JSON extractable)
- `ReviewJsonParser.parse()` with JSON missing required fields → throws listing the missing field names
- `PromptBuilder.buildUserPrompt()` with an empty `files` array → returns a prompt with `Changed files (0)` header
- `OutputFormatter.filterBySeverity()` with an empty findings array → returns `[]`

### API errors

Not applicable — no network calls in the six in-scope classes.

### No connection

Not applicable.

### Timeout

Not applicable.

### Empty or unexpected response

- `ReviewJsonParser.parse()` with `{}` (valid JSON, missing all required fields) → throws error listing all three missing fields
- `RulesLoader.loadGlobalRules()` when both template and generic fallback are not found → returns `{}`

### Double submit

Not applicable.

## 12. Required UI States

Not applicable — no UI layer.

## 13. Validations

Not applicable — no user input forms.

## 14. Security & Permissions

- **Secrets in tests:** Tests must never hardcode real `OPENAI_API_KEY` or `GITHUB_TOKEN`. Tests for the six in-scope classes make zero external API calls — no keys needed.
- **Temp file cleanup:** Tests that write to `os.tmpdir()` must clean up in `afterEach` to avoid polluting the temp directory across test runs.
- **No real credentials in fixtures:** Any fixture YAML or JSON files used in tests must use placeholder strings (e.g., `model: gpt-4o-test`), not real API keys.

## 15. Observability & Logging

- **What tests must NOT log:** Real OpenAI API responses, real GitHub tokens, or stack traces from expected errors (use `expect(() => ...).toThrow()` instead of `try/catch` with `console.error`)
- **Console spy:** `vi.spyOn(console, 'log')` should be restored after each test via `afterEach(() => vi.restoreAllMocks())`
- **No debugging logs left in test files:** No `console.log`, `console.error`, or `debugger` statements in committed test code

## 16. i18n / User-facing Copy

Not applicable — test files contain no user-facing strings. (Note: `OutputFormatter` produces Spanish strings like `'Resumen:'`, `'Recomendación:'` — tests verify output structure via `console.log` spy call counts, not the Spanish string values, to avoid coupling tests to user-facing copy.)

## 17. Performance

- Each test must complete in < 500ms (no real API calls means this is easily achievable)
- Temp directory creation/deletion in `beforeEach`/`afterEach` is acceptable overhead
- `npm test` (all 44+ tests) must complete in < 30 seconds on a development machine

## 18. Restrictions

The implementer must NOT:

- [ ] Use `any` or `unknown` as a type in any refactored source file or test file
- [ ] Pass separate positional parameters to any class method — all params must be a single typed interface object (exception: single-primitive callbacks)
- [ ] Declare standalone module-level functions in the six refactored files (only `const` data is permitted at module level)
- [ ] Make real OpenAI, Anthropic, Gemini, or GitHub API calls from any test
- [ ] Write `if`, `switch`, or `for` logic inside any `it()` block — use `it.each()` for varying inputs
- [ ] Add more than one conceptual assertion per `it()` (multiple `expect()` calls for facets of the same result are OK)
- [ ] Place test files alongside source files — all tests go in `__test__/`
- [ ] Refactor `src/reviewer.ts`, `src/github.ts`, `src/action.ts`, or any `src/llm/` adapter (other than `json-parser.ts`)
- [ ] Add new npm dependencies beyond `vitest` and `@vitest/coverage-v8`
- [ ] Change the public behavior of any refactored class — the refactor is structural only

## 19. Deliverables

- [ ] `vitest.config.ts` created with correct ESM + node + coverage configuration
- [ ] `package.json` updated with vitest devDeps and test scripts
- [ ] All six source files refactored to classes (`ConfigLoader`, `TechDetector`, `PromptBuilder`, `OutputFormatter`, `RulesLoader`, `ReviewJsonParser`)
- [ ] `src/reviewer.ts` and `src/cli.ts` updated to use the new class API
- [ ] `npm run build` passes with zero errors
- [ ] All six test files created under `__test__/` (including `__test__/llm/`)
- [ ] `npm test` passes — zero failing tests
- [ ] `npm test -- --coverage` shows ≥ 80% line coverage for each class

## 20. Final Agent Checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] Confirmed no `any`/`unknown` in any modified file
- [ ] Confirmed no standalone module-level functions in the six refactored source files
- [ ] Confirmed `src/reviewer.ts` and `src/cli.ts` updated to use class instances
- [ ] Confirmed no tests in `src/` — all test files are in `__test__/`
- [ ] Confirmed every `it()` follows AAA pattern with three comment blocks
- [ ] Confirmed no logic (`if`/`for`/`switch`) inside any `it()` block
- [ ] Confirmed no real API calls in any test
- [ ] Confirmed temp directories cleaned up in `afterEach` where applicable
- [ ] Confirmed `vi.restoreAllMocks()` called in `afterEach` where spies are used
- [ ] Ran `npm run build` — zero TypeScript errors
- [ ] Ran `npm test` — zero failing tests
- [ ] Ran `npm test -- --coverage` — all six classes show ≥ 80% line coverage
- [ ] Ran `npx tsc --noEmit` — zero errors including test files
- [ ] No temporary logs, `console.log`, or `debugger` left in committed code
- [ ] No unjustified `TODO` comments
