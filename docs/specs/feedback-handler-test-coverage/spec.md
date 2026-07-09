# Feedback Handler Test Coverage

> **Status:** PENDING PROPOSAL/CHANGE — no OpenSpec change has been generated yet. Run `/openspec-propose` (or `/opsx:propose`) using this spec as input.

## 1. Goal

Fill the test coverage gaps in the inline-comment feedback subsystem. The core classes (`FeedbackHandler`, `ThreadResolver`) already have tests. What's missing: the `handleFeedback()` CLI orchestrator in `src/handle-feedback.ts` has zero tests, and the pure helper functions in `src/github.ts` related to feedback event parsing (`getReviewCommentEventFromEnv`, `getPullRequestContextFromEnv`, `buildDiffLineMap`) have no test coverage. This spec adds targeted unit tests for those gaps so the feedback pipeline is verifiable from entry point to exit.

## 2. Scope

### Included in this phase

- New `__test__/handle-feedback.test.ts` covering `handleFeedback()` in `src/handle-feedback.ts`:
  - `feedback.enabled: false` → exits silently before any GitHub API call
  - No event in environment (null from `getReviewCommentEventFromEnv`) → throws Error
  - Event exists but `inReplyToId` is null → exits silently
  - Happy path → `FeedbackHandler.handle()` is called with the correct `FeedbackEvent`
- Extend `__test__/github.test.ts` with tests for pure functions not yet covered:
  - `getReviewCommentEventFromEnv()` — env var absent, event file missing, valid reply event, event with no `in_reply_to_id`
  - `getPullRequestContextFromEnv()` — env var absent, valid `pull_request` event, event missing `pull_request` field
  - `buildDiffLineMap()` — empty input, single file with additions, multiple files

### Out of scope

- Integration tests against a real GitHub repository
- End-to-end tests that send actual HTTP requests to the GitHub API
- Tests for `FeedbackHandler` or `ThreadResolver` — those are already covered in their own test files
- Tests for Octokit-calling methods on `GitHubClient` (`getReviewComment`, `postReply`, `resolveThread`, `getPullRequestReviewComments`) — these wrap Octokit directly and would only test mocks, not behavior
- Load / performance testing
- Tests for `src/llm/` adapters — out of scope for the feedback subsystem
- Tests for `handleFeedback()` LLM failure path — LLM is mocked at the `llmCall` boundary inside `FeedbackHandler`, already covered in `feedback-handler.test.ts`

## 3. Technologies & Conventions

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js `>=18.0.0`
- **Package manager**: npm
- **Build**: `tsc` → `dist/`
- **Test framework**: Vitest (`npm test` → `vitest run`)
- **No new dependencies required**

### Relevant versions (from `package.json`)

| Field | Value |
|---|---|
| `version` | `0.1.0-beta.4` |
| `node` engine | `>=18.0.0` |
| `typescript` | `^5.6.0` |
| `vitest` | `^3.2.6` |

### Existing patterns to follow

- AAA pattern: every `it()` has `// Arrange`, `// Act`, `// Assert` blocks (CLAUDE.md testing section)
- Factory functions at file scope: `makeFeedbackEvent()`, `makeMetadata()`, `makeConfig()` in `__test__/feedback-handler.test.ts`
- Module mocking with `vi.mock()` — used throughout the test suite to isolate the class under test
- `vi.stubEnv()` + `vi.unstubAllEnvs()` for environment variable isolation
- `tmp` files via `fs.mkdtempSync` + cleanup in `afterEach` when testing functions that read files
- TypeScript: no `any`/`unknown`, all params in typed objects, all mocks typed against real interfaces

## 4. Prerequisites

- [x] `handleFeedback()` exists and is exported from `src/handle-feedback.ts`
- [x] `getReviewCommentEventFromEnv()` is exported from `src/github.ts`
- [x] `getPullRequestContextFromEnv()` is exported from `src/github.ts`
- [x] `buildDiffLineMap()` is exported from `src/github.ts`
- [x] `FeedbackHandler` exists in `src/feedback-handler.ts`
- [x] `ConfigLoader` exists in `src/config.ts`
- [x] `GitHubClient` exists in `src/github.ts`
- [x] `createLLMAdapter` exists in `src/llm/factory.ts`
- [x] Vitest is installed and configured in `vitest.config.ts` with `include: ['__test__/**/*.test.ts']`
- [x] `__test__/github.test.ts` exists and can be extended

## 5. Architecture

**Pattern**: pure unit tests. No network calls, no real file system access beyond controlled temp files.

**Affected layers**:

| Layer | Changed | Description |
|---|---|---|
| `__test__/handle-feedback.test.ts` | NEW | Unit tests for `handleFeedback()` orchestrator using `vi.mock` |
| `__test__/github.test.ts` | MODIFY | Add `describe` blocks for `getReviewCommentEventFromEnv`, `getPullRequestContextFromEnv`, `buildDiffLineMap` |
| `src/` (any file) | no | No source changes — tests only |

**Testing strategy per target**:

`handleFeedback()` imports four modules that must be mocked:
- `./config.js` → mock `ConfigLoader` class
- `./github.js` → mock `GitHubClient` class and `getReviewCommentEventFromEnv` function
- `./feedback-handler.js` → mock `FeedbackHandler` class
- `./llm/factory.js` → mock `createLLMAdapter` function

Use `vi.mock()` at the top of `handle-feedback.test.ts` for each. Restore with `vi.restoreAllMocks()` in `afterEach`.

`getReviewCommentEventFromEnv()` and `getPullRequestContextFromEnv()` read `process.env.GITHUB_REPOSITORY`, `process.env.GITHUB_EVENT_PATH`, and a JSON file at that path. Use `vi.stubEnv()` for env vars and `fs.writeFileSync` to a temp file for the event payload.

`buildDiffLineMap()` is a pure function (no I/O) — no mocking needed.

## 6. Files to Create / Modify

| Path | Action | Purpose | Follow |
|---|---|---|---|
| `__test__/handle-feedback.test.ts` | NEW | Unit tests for `handleFeedback()` CLI orchestrator | `__test__/feedback-handler.test.ts` |
| `__test__/github.test.ts` | MODIFY | Add tests for `getReviewCommentEventFromEnv`, `getPullRequestContextFromEnv`, `buildDiffLineMap` | Existing `describe` blocks in same file |

### Detail per file

**`__test__/handle-feedback.test.ts`** (new file)

Tests `handleFeedback()` from `src/handle-feedback.ts`. Uses `vi.mock()` to isolate all dependencies.

Mocked modules:
- `../src/config.js` — `ConfigLoader` constructor + `loadConfig()` method
- `../src/github.js` — `GitHubClient` constructor and `getReviewCommentEventFromEnv` function
- `../src/feedback-handler.js` — `FeedbackHandler` constructor + `handle()` method
- `../src/llm/factory.js` — `createLLMAdapter` function

Required test scenarios (all in `describe('handleFeedback')`):

| Scenario | `it()` description |
|---|---|
| `feedback.enabled: false` | `should return without calling GitHub client when feedback is disabled` |
| No event in environment | `should throw when no pull_request_review_comment event is found in the environment` |
| `inReplyToId` is null | `should return without calling FeedbackHandler when the comment is not a reply` |
| Happy path | `should call FeedbackHandler.handle with the correct FeedbackEvent` |

Do NOT test the LLM path (the `llmCall` lambda) — that boundary is already covered in `feedback-handler.test.ts`.

**`__test__/github.test.ts`** (extend existing file)

Add three new `describe` blocks after the existing ones:

1. `describe('getReviewCommentEventFromEnv')` — 4 tests:

| Scenario | `it()` description |
|---|---|
| `GITHUB_REPOSITORY` absent | `should return null when GITHUB_REPOSITORY is not set` |
| Event file does not exist | `should return null when GITHUB_EVENT_PATH points to a missing file` |
| Valid reply comment event | `should return parsed event when the event file contains a valid pull_request_review_comment` |
| Comment has no `in_reply_to_id` | `should return null inReplyToId when the comment has no in_reply_to_id field` |

2. `describe('getPullRequestContextFromEnv')` — 3 tests:

| Scenario | `it()` description |
|---|---|
| `GITHUB_REPOSITORY` absent | `should return null when GITHUB_REPOSITORY is not set` |
| Valid pull_request event | `should return a PullRequestContext when the event file contains a valid pull_request payload` |
| Event has no `pull_request` field | `should return null when the event payload has no pull_request field` |

3. `describe('buildDiffLineMap')` — 3 tests:

| Scenario | `it()` description |
|---|---|
| Empty input | `should return an empty map when given no changed files` |
| Single file with added lines | `should include all added line numbers for a single changed file` |
| Multiple files | `should build a separate line set for each file path` |

## 7. API Contract

No new API surface. Tests exercise internal functions only. No `api-contract.md` needed.

## 8. Success Criteria

- [ ] `__test__/handle-feedback.test.ts` exists with 4 passing tests
- [ ] `__test__/github.test.ts` extended with 10 passing tests (4 + 3 + 3)
- [ ] All tests follow the AAA pattern with explicit `// Arrange`, `// Act`, `// Assert` comments
- [ ] No `any` or `unknown` types introduced in test files
- [ ] `npm test` exits 0 (all 14 new tests pass, existing tests unchanged)
- [ ] `npm run build` exits 0

### Required tests

**`__test__/handle-feedback.test.ts`** (4 tests):

| Test | Scenario |
|---|---|
| `should return without calling GitHub client when feedback is disabled` | `config.feedback.enabled = false` → `GitHubClient` constructor never called |
| `should throw when no pull_request_review_comment event is found in the environment` | `getReviewCommentEventFromEnv` returns null → `handleFeedback()` throws Error |
| `should return without calling FeedbackHandler when the comment is not a reply` | Event has `inReplyToId: null` → `FeedbackHandler.handle` never called |
| `should call FeedbackHandler.handle with the correct FeedbackEvent` | Valid event → `FeedbackHandler.handle` called once with matching `FeedbackEvent` object |

**`__test__/github.test.ts`** (10 new tests):

| Describe | Test |
|---|---|
| `getReviewCommentEventFromEnv` | `should return null when GITHUB_REPOSITORY is not set` |
| `getReviewCommentEventFromEnv` | `should return null when GITHUB_EVENT_PATH points to a missing file` |
| `getReviewCommentEventFromEnv` | `should return parsed event when the event file contains a valid pull_request_review_comment` |
| `getReviewCommentEventFromEnv` | `should return null inReplyToId when the comment has no in_reply_to_id field` |
| `getPullRequestContextFromEnv` | `should return null when GITHUB_REPOSITORY is not set` |
| `getPullRequestContextFromEnv` | `should return a PullRequestContext when the event file contains a valid pull_request payload` |
| `getPullRequestContextFromEnv` | `should return null when the event payload has no pull_request field` |
| `buildDiffLineMap` | `should return an empty map when given no changed files` |
| `buildDiffLineMap` | `should include all added line numbers for a single changed file` |
| `buildDiffLineMap` | `should build a separate line set for each file path` |

### Verification commands

```bash
npm run build    # must exit 0
npm test         # must exit 0, 14 new tests green
```

## 9. UX Criteria

Not applicable — this is a test-only change with no user-facing output.

## 10. Decisions Made (Locked)

- **No tests for Octokit-calling methods.** `getReviewComment()`, `postReply()`, `resolveThread()`, `getPullRequestReviewComments()` all delegate directly to Octokit. Unit tests for these would only assert that a mock was called — no behavior is verified. Rationale: testing mocks is not valuable; the real coverage comes from the integration tested via `FeedbackHandler` and `ThreadResolver` tests.
- **`handleFeedback()` tested via `vi.mock()`.** The function instantiates classes internally (no dependency injection), so module-level mocking is the only way to unit test it. Rationale: the function's value is its orchestration logic (which config key to check, what to throw, what args to pass to `FeedbackHandler.handle`), not the wiring of real collaborators.
- **`buildDiffLineMap()` tested without mocks.** It is a pure transformation function. Rationale: pure functions need no mocks — pass input, assert output.
- **Temp files for env-reading functions.** `getReviewCommentEventFromEnv()` and `getPullRequestContextFromEnv()` read a JSON file from disk. Tests write a minimal event payload to a temp file and point `GITHUB_EVENT_PATH` at it. Cleanup in `afterEach`. Rationale: mocking `fs.readFileSync` is brittle; temp files are stable and close to real execution.

## 11. Edge Cases

| Case | Expected behavior in tests |
|---|---|
| `GITHUB_REPOSITORY` contains no `/` | `getPullRequestContextFromEnv()` returns null — assert null |
| `GITHUB_EVENT_PATH` set but file has invalid JSON | Both env functions return null — assert null |
| `in_reply_to_id` present but `0` | `getReviewCommentEventFromEnv()` treats it as falsy — assert `inReplyToId: null` |
| `buildDiffLineMap()` file with only deletions (no added lines) | Returns an empty `Set` for that file path — assert `size === 0` |
| `handleFeedback()` called with `feedback` key entirely absent from config | `feedbackConfig` is `undefined` — `feedback?.enabled` is falsy → returns silently |

## 12. Required UI States

Not applicable — no UI changes.

## 13. Validations

Not applicable — tests verify behavior, not user input validation rules.

## 14. Security & Permissions

- Tests must never log or assert the value of `GITHUB_TOKEN` — existing convention from the test suite
- `vi.stubEnv` / `vi.unstubAllEnvs()` ensure env pollution does not leak between tests
- Temp files must be cleaned up in `afterEach` — no leftover files on the test runner filesystem

## 15. Observability & Logging

No new logging. Tests that invoke `handleFeedback()` with `chalk` output may print to stdout — acceptable in test runs. If noisy, add `vi.spyOn(console, 'log').mockReturnValue(undefined)` in `beforeEach` for the `handle-feedback.test.ts` describe block.

## 16. i18n / User-Facing Copy

Not applicable — test files contain no user-facing strings. The tested Spanish strings (e.g., `'Feedback feature is not enabled'` in `handle-feedback.ts`) are asserted by checking that no GitHub call was made, not by asserting the exact logged message.

## 17. Performance

- 14 new tests — all synchronous or trivially async (mocked I/O)
- Expected impact on `npm test` run time: < 200ms additional
- No new production code paths → zero runtime overhead

## 18. Restrictions

- **Do NOT modify any file under `src/`** — tests only; zero source changes
- **Do NOT add new npm dependencies** — Vitest, `vi.mock`, `vi.stubEnv`, `fs` (Node built-in) are sufficient
- **Do NOT test Octokit-calling methods** — see §10 decision
- **Do NOT add tests for `FeedbackHandler` or `ThreadResolver`** — those files already have their own test files; do not duplicate or extend them here
- **Do NOT use `as any` to bypass types in test mocks** — use `as unknown as InterfaceType` pattern (same as existing `feedback-handler.test.ts:72`)
- **Do NOT write tests that assert exact Spanish log message strings** — log messages are implementation details that can change; test observable side effects instead

## 19. Deliverables

- [ ] `__test__/handle-feedback.test.ts` created with 4 tests
- [ ] `__test__/github.test.ts` extended with 10 new tests across 3 new `describe` blocks
- [ ] All 14 new tests pass (`npm test` exits 0)
- [ ] All new tests follow AAA pattern
- [ ] No `any` or `unknown` types in new test code
- [ ] Temp files cleaned up in `afterEach` for env-reading function tests
- [ ] `npm run build` exits 0

## 20. Final Agent Checklist

- [ ] Read this spec end-to-end before writing any code
- [ ] Read `__test__/feedback-handler.test.ts` as the primary style reference before writing `handle-feedback.test.ts`
- [ ] Read `__test__/github.test.ts` before extending it — match existing factory function and describe structure
- [ ] Confirmed `handleFeedback()` in `src/handle-feedback.ts` is exported and importable
- [ ] Confirmed `getReviewCommentEventFromEnv`, `getPullRequestContextFromEnv`, `buildDiffLineMap` are exported from `src/github.ts`
- [ ] `vi.mock()` declarations placed at the top of `handle-feedback.test.ts` (before any imports that use the mocked modules)
- [ ] `vi.stubEnv()` used for env vars, `vi.unstubAllEnvs()` called in `afterEach`
- [ ] Temp files written with `fs.mkdtempSync` or `fs.writeFileSync` to a known temp path, cleaned up in `afterEach`
- [ ] No source files modified
- [ ] `npm run build` passes
- [ ] `npm test` passes (14 new tests + all existing tests green)
- [ ] No new npm dependencies added
