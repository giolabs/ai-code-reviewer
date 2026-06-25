# Inline Comment Feedback

> **Status:** DRAFT

## 1. Goal

Enable developers to interact with AI-generated inline PR comments by replying with `/explain` (request detailed reasoning) or `/dismiss` (mark finding as irrelevant). The AI automatically resolves review threads when the developer pushes a fix that addresses the flagged finding. This closes the feedback loop between AI reviewer and developer without leaving the PR.

## 2. Scope

### Included in this phase

- New GitHub Actions workflow `.github/workflows/handle-feedback.yml` triggered by `pull_request_review_comment` events
- New `handle-feedback` CLI command that processes a single review comment reply
- `/explain` slash command: AI replies in the same thread with detailed reasoning about the finding
- `/dismiss` slash command: AI marks the finding as dismissed, resolves the thread, updates the summary comment
- Auto-resolve on push: after each `review-pr` run, threads whose findings no longer appear in the re-analysis are resolved automatically with a confirmation message
- State persistence via hidden HTML comment metadata embedded in the AI's original inline comment body
- Summary comment updated (dismissed/fixed count) when finding status changes
- Opt-in via `.ai-review.yml` key `feedback.enabled: true`
- Any PR participant (not just authors) can use slash commands
- **Refactor `src/github.ts`** from module-level functions to a `GitHubClient` class (prerequisite for the new methods; all existing callers in `reviewer.ts` updated accordingly)
- Add `@octokit/graphql` dependency for the `resolveReviewThread` GraphQL mutation

### Out of scope

- `/reanalyze` or other slash commands beyond `/explain` and `/dismiss`
- Un-dismissing a previously dismissed finding
- Bulk dismiss (dismiss all findings at once)
- Slash commands in the top-level PR summary comment (only in inline diff comment threads)
- Custom dismiss reason or free-text reply parsing (slash commands only)
- Notification system or Slack integration
- UI for browsing dismissed findings history
- Support for self-hosted GitHub Enterprise (REST/GraphQL API surface is assumed to match github.com)

## 3. Technologies & Conventions

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js `>=18.0.0`
- **Package manager**: npm
- **Build**: `tsc` → `dist/`
- **Test**: Vitest (`npm test` → `vitest run`)
- **GitHub API**: `@octokit/rest` (REST) + GitHub GraphQL API for `resolveReviewThread`
- **LLM**: OpenAI structured output (`response_format: json_schema`) — same as `openai.ts`
- **CI**: GitHub Actions

### Relevant versions (from `package.json`)

| Field | Value |
|---|---|
| `version` | `0.1.0-beta.2` |
| `node` engine | `>=18.0.0` |
| `typescript` | `^5.6.0` |
| `vitest` | `^3.2.6` |
| `@octokit/rest` | current (already a dependency — check `package.json`) |
| `@octokit/graphql` | NEW — to be installed (`npm install @octokit/graphql`) |

### Existing patterns to follow

- All logic in classes; one class per file (`src/github.ts` → `GitHubClient` class)
- Constructor dependency injection; no `new` inside methods
- Explicit return types on every class method
- `async/await` for all async operations
- `interface` for object shapes, `enum` for closed value sets
- No `any` or `unknown` without narrowing — create explicit types
- HTML metadata format mirrors how `postReview()` already embeds a signature; the new metadata block extends that pattern
- CLI commands defined in `src/cli.ts` using Commander; each command delegates to a class in `src/reviewer.ts` or a dedicated handler

## 4. Prerequisites

- [ ] `github.ts` must be refactored to a `GitHubClient` class — currently it exports only module-level functions (`getPullRequestContextFromEnv`, `createOctokit`, `getPullRequestFiles`, `postReview`, `buildDiffLineMap`); the refactor wraps them into a class and is the first implementation step
- [x] `reviewer.ts` has `reviewPullRequest()` that runs the full review pipeline
- [x] `types.ts` defines `ReviewFinding`, `ReviewResult`, `ChangedFile`, `PullRequestContext`
- [x] `openai.ts` has `OpenAIClient` with structured output
- [x] `config.ts` loads `.ai-review.yml` into `ReviewerConfig`
- [x] `cli.ts` exposes Commander-based commands
- [ ] The `@octokit/graphql` package or equivalent GraphQL support must be available (see Section 7 — resolve thread requires GraphQL)
- [ ] `GITHUB_TOKEN` must have `pull-requests: write` permission in the feedback workflow (required for posting replies and resolving threads)
- [ ] `OPENAI_API_KEY` must be available in the feedback workflow environment

## 5. Architecture

### Pattern

Event-driven extension of the existing review pipeline. Two distinct triggers:
1. **Comment reply trigger** (`pull_request_review_comment`) → `FeedbackHandler` class
2. **Push trigger** (existing `review-pr` workflow) → extended with `ThreadResolver` logic in `Reviewer`

### Affected layers

| Layer | Affected? | Description |
|---|---|---|
| `.github/workflows/handle-feedback.yml` | **Yes — NEW** | Triggers on review comment replies, runs `handle-feedback` command |
| `.github/workflows/ai-review.yml` | **Yes — MODIFY** | Add auto-resolve step after `review-pr` completes |
| `src/cli.ts` | **Yes — MODIFY** | Add `handle-feedback` command |
| `src/feedback-handler.ts` | **Yes — NEW** | `FeedbackHandler` class — parses slash command, calls LLM or dismisses |
| `src/thread-resolver.ts` | **Yes — NEW** | `ThreadResolver` class — compares previous vs current findings, resolves fixed threads |
| `src/github.ts` | **Yes — MODIFY** | Add `postReply()`, `editComment()`, `resolveThread()`, `extractFindingMetadata()`, `embedFindingMetadata()` |
| `src/reviewer.ts` | **Yes — MODIFY** | After posting review, embed metadata in each inline comment; add `resolveFixedThreads()` call |
| `src/prompts.ts` | **Yes — MODIFY** | Add `buildExplainPrompt()` method |
| `src/config.ts` | **Yes — MODIFY** | Parse `feedback:` section from `.ai-review.yml` |
| `src/types.ts` | **Yes — MODIFY** | Add `FindingStatus`, `FindingMetadata`, `FeedbackConfig`, `SlashCommand` |
| `src/output.ts` | No | Terminal output unchanged |
| `src/openai.ts` | No | Reused as-is |
| `src/tech-detect.ts` | No | Unchanged |
| `templates/` | No | Unchanged |

### Finding metadata format

Each AI inline comment body includes a hidden HTML comment block at the end:

```html
<!-- ai-review-finding:{"id":"f_abc123","file":"src/auth.ts","line":42,"severity":"high","status":"open","dismissedBy":null} -->
```

- `id`: deterministic hash of `file + line + message` (prevents collision across pushes)
- `status`: `"open" | "dismissed" | "resolved"`
- `dismissedBy`: GitHub login of the participant who dismissed, or `null`

The `status` field is the authoritative state. The `id` is used to match threads across pushes.

### Expected flow — `/explain`

1. Developer replies to an inline AI comment with `/explain`
2. `handle-feedback.yml` fires, calls `npx ... handle-feedback`
3. `FeedbackHandler.handle()` reads the triggering comment, extracts the parent comment ID
4. Fetches the parent comment body, parses the `ai-review-finding` metadata
5. Builds an explain prompt with the finding + surrounding code context via `buildExplainPrompt()`
6. Calls OpenAI, receives plain-text explanation
7. Posts the explanation as a reply in the same thread via `GitHubClient.postReply()`
8. Does NOT change the finding status

### Expected flow — `/dismiss`

1. Developer replies with `/dismiss`
2. `FeedbackHandler.handle()` extracts metadata from parent comment
3. Updates `status` to `"dismissed"`, sets `dismissedBy` to the actor login
4. Edits the original AI comment body to reflect the updated metadata (silent — no visible change to the comment text, only the HTML comment block changes)
5. Resolves the GitHub review thread via `GitHubClient.resolveThread()` (GraphQL mutation)
6. Posts a reply: _"Finding dismissed by @{actor}. Thread resolved."_
7. Edits the PR summary comment to update the dismissed count via `GitHubClient.editComment()`

### Expected flow — auto-resolve on push

1. Developer pushes a commit addressing a finding
2. `review-pr` workflow runs, re-analyzes changed files
3. After posting the new review, `Reviewer.resolveFixedThreads()` is called with the new `ReviewResult` and the PR's `summaryCommentId` (returned by the updated `postReview()`)
4. `ThreadResolver` fetches **all** open PR review comments posted by the bot (paginating if >100 comments)
5. For each comment with `ai-review-finding` metadata and `status: "open"`:
   - Checks if the comment's `file` is among the files changed in this push (filter: only re-check files in the current diff)
   - If the file was not changed in this push, skip (leave thread open — don't close for unrelated pushes)
   - If the file was changed, checks if the finding `id` appears in the new `ReviewResult.findings`
6. If the finding is absent from the new result (fixed): calls `GitHubClient.resolveThread()` and posts a reply: _"Fixed in {commitSha[:7]}. Thread resolved."_
7. Updates the PR summary comment with the resolved count

### File layout for new files

```
src/
  feedback-handler.ts   ← FeedbackHandler class
  thread-resolver.ts    ← ThreadResolver class
.github/
  workflows/
    handle-feedback.yml ← new workflow
```

## 6. Files to Create / Modify

| Path | Action | Purpose | Example to follow |
|---|---|---|---|
| `src/github.ts` | MODIFY (refactor first) | Wrap module functions into `GitHubClient` class; add 5 new methods | Existing functions in same file |
| `src/feedback-handler.ts` | NEW | Parse slash command and dispatch to explain/dismiss | `src/reviewer.ts` (class structure, DI pattern) |
| `src/thread-resolver.ts` | NEW | Compare previous vs current findings, resolve fixed threads | `src/reviewer.ts` |
| `.github/workflows/handle-feedback.yml` | NEW | Trigger `handle-feedback` on review comment replies | `.github/workflows/ci.yml` |
| `src/cli.ts` | MODIFY | Add `handle-feedback` command | Existing `review-pr` command in same file |
| `src/reviewer.ts` | MODIFY | Update to use `GitHubClient` class; embed metadata; add `resolveFixedThreads()` | Existing `reviewPullRequest()` |
| `src/prompts.ts` | MODIFY | Add `buildExplainPrompt()` | Existing `buildSystemPrompt()` |
| `src/config.ts` | MODIFY | Parse `feedback:` block | Existing `loadConfig()` |
| `src/types.ts` | MODIFY | Add feedback-related types and enums | Existing type definitions in same file |
| `package.json` + `package-lock.json` | MODIFY | Add `@octokit/graphql` dependency | — |

### Detail per file

#### `src/feedback-handler.ts`

Single exported class `FeedbackHandler`. Constructor receives `GitHubClient`, `OpenAIClient`, `ReviewerConfig`. Public method `handle(event: FeedbackEvent): Promise<void>`.

Responsibilities:
- Parse the reply body to detect `SlashCommand` (`explain` | `dismiss` | `unknown`)
- If `unknown`, exit silently (no reply posted)
- If `explain`: fetch parent comment, extract `FindingMetadata`, call `OpenAIClient` via explain prompt, post reply
- If `dismiss`: extract metadata, update status, edit parent comment body, resolve thread, post dismissal reply, update summary comment
- Must NOT re-run the full review pipeline

Must NOT contain: tech detection, diff parsing, file reading, or any GitHub event parsing beyond what's passed via `FeedbackEvent`.

#### `src/thread-resolver.ts`

Single exported class `ThreadResolver`. Constructor receives `GitHubClient`. Public method `resolveFixed(options: ResolveFixedOptions): Promise<void>`.

Responsibilities:
- Fetch all review comments on the PR from the bot user
- Filter to those with `ai-review-finding` metadata and `status: "open"`
- Cross-reference with the new `ReviewResult.findings` using `FindingMetadata.id`
- For each finding absent from the new result: resolve thread, post confirmation reply
- Update the PR summary comment

Must NOT: call OpenAI, read config, or re-analyze files.

#### `.github/workflows/handle-feedback.yml`

```yaml
name: Handle Feedback

on:
  pull_request_review_comment:
    types: [created]

jobs:
  feedback:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx -y @giolabsuy/ai-code-reviewer@latest handle-feedback
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_EVENT_PATH: ${{ github.event_path }}
```

The workflow must NOT run when the comment author is the bot itself (guard in `FeedbackHandler.handle()` by comparing actor login to `GITHUB_ACTOR` or the bot's own token username).

#### `src/github.ts` — refactor + additions

**Step 1 (prerequisite):** Wrap existing module-level functions into a `GitHubClient` class. The constructor receives an authenticated `Octokit` instance and the `@octokit/graphql` client. All existing callers in `reviewer.ts` must be updated to instantiate and use `GitHubClient`. No behavior change — pure structural refactor.

**Step 2:** Add new methods to `GitHubClient`:

`postReview()` must be updated to return `Promise<number>` (the created summary comment ID) instead of `Promise<void>`, so the caller can pass it into `ResolveFixedOptions.summaryCommentId`.

New methods:

```typescript
postReply(options: PostReplyOptions): Promise<void>
// POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/replies

editComment(options: EditCommentOptions): Promise<void>
// PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}
// Also used for issue comments (summary): PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}

resolveThread(options: ResolveThreadOptions): Promise<void>
// GitHub GraphQL: mutation resolveReviewThread

extractFindingMetadata(commentBody: string): FindingMetadata | null
// Parse <!-- ai-review-finding:{...} --> from comment body

embedFindingMetadata(commentBody: string, metadata: FindingMetadata): string
// Append or replace <!-- ai-review-finding:{...} --> block in comment body
```

#### `src/types.ts` additions

```typescript
enum FindingStatus {
  Open = 'open',
  Dismissed = 'dismissed',
  Resolved = 'resolved',
}

enum SlashCommand {
  Explain = 'explain',
  Dismiss = 'dismiss',
  Unknown = 'unknown',
}

// NOTE: Severity is already declared in types.ts as:
//   export type Severity = 'critical' | 'major' | 'minor' | 'info' | 'nitpick';
// It must NOT be promoted to an enum — use the existing type alias as-is.

interface FindingMetadata {
  id: string;
  file: string;
  line: number;
  severity: Severity;    // existing type alias — do not change
  status: FindingStatus;
  dismissedBy: string | null;
  commentId: number;
  // threadNodeId: GitHub GraphQL node ID of the review thread.
  // Source: the `node_id` field on the review thread object returned by
  // GET /repos/{owner}/{repo}/pulls/{pull_number}/comments (each comment's
  // `pull_request_review_id` maps to a thread; use the thread's node_id,
  // which is available in the `pull_request_review_comment` webhook payload
  // as `event.comment.node_id` of the thread via the Reviews API).
  // In practice: capture it from the webhook event at comment-post time.
  threadNodeId: string;
}

interface FeedbackConfig {
  enabled: boolean;
  allowDismiss: boolean;
}

interface FeedbackEvent {
  actor: string;
  // commentId: ID of the reply comment (the one containing the slash command).
  // Source: webhook event `event.comment.id`.
  commentId: number;
  commentBody: string;
  // parentCommentId: ID of the AI's original inline comment being replied to.
  // Source: webhook event `event.comment.in_reply_to_id`.
  // Note: GitHub sets `in_reply_to_id` only when the comment is a reply;
  // if it is absent, the comment is a top-level review comment and should be ignored.
  parentCommentId: number;
  pullNumber: number;
  repo: string;
  owner: string;
}

// ExplainPromptOptions: input to PromptBuilder.buildExplainPrompt()
interface ExplainPromptOptions {
  findingMessage: string;       // the AI's original finding description
  filePath: string;
  line: number;
  severity: Severity;
  codeContext: string;          // up to 20 lines of surrounding code
  language: string;             // from ReviewerConfig.language (e.g. 'es', 'en')
}

interface ResolveFixedOptions {
  pullNumber: number;
  owner: string;
  repo: string;
  newFindings: ReadonlyArray<ReviewFinding>;
  commitSha: string;
  summaryCommentId: number;
}
```

#### `src/config.ts` additions

Parse the `feedback:` block in `.ai-review.yml`:

```yaml
feedback:
  enabled: true      # default: false (opt-in)
  allowDismiss: true # default: true
```

Merge into `ReviewerConfig.feedback: FeedbackConfig`. Default: `{ enabled: false, allowDismiss: true }`.

#### `src/prompts.ts` additions

New method `buildExplainPrompt(options: ExplainPromptOptions): string` on `PromptBuilder`. Receives the `FindingMetadata`, the finding message, the file path, and up to 20 lines of surrounding code context. Returns a prompt that asks the model to explain why the AI flagged this finding, in the configured language, in 3–5 sentences.

## 7. API Contract

### REST endpoints used

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/repos/{owner}/{repo}/pulls/comments/{comment_id}/replies` | Post reply in thread |
| `PATCH` | `/repos/{owner}/{repo}/pulls/comments/{comment_id}` | Edit inline comment (update metadata) |
| `PATCH` | `/repos/{owner}/{repo}/issues/comments/{comment_id}` | Edit PR summary comment |
| `GET` | `/repos/{owner}/{repo}/pulls/{pull_number}/comments` | Fetch all inline comments on PR |

### GraphQL mutation

```graphql
mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}
```

`threadId` is the GraphQL node ID of the review thread. It is obtained from the `pull_request_review_comment` event payload (`event.comment.pull_request_review_id` → thread node ID, or directly from the REST response `node_id` field on the parent comment's thread).

**Note**: the GitHub REST API does not expose a `resolveReviewThread` endpoint. The GraphQL API must be used. Use `@octokit/graphql` or the existing Octokit instance's `.graphql()` method.

### Auth

All calls use `GITHUB_TOKEN` from Actions environment. No additional scopes beyond `pull-requests: write` are required.

## 8. Success Criteria

- [ ] `feedback.enabled: false` (default) causes `handle-feedback` to exit 0 silently without calling GitHub or OpenAI APIs
- [ ] `/explain` reply triggers a reply in the same thread containing the AI's reasoning
- [ ] `/explain` does NOT resolve the thread or change finding status
- [ ] `/dismiss` reply resolves the thread and posts a dismissal message
- [ ] `/dismiss` with `feedback.allowDismiss: false` replies with an error message and does not resolve
- [ ] After a push, threads for findings that no longer appear in the re-analysis are automatically resolved with a commit reference
- [ ] After a push, threads for findings that still appear are left open
- [ ] The PR summary comment reflects updated dismissed/resolved counts
- [ ] Bot does not respond to its own comments (no infinite loops)
- [ ] Unrecognized comment body (no slash command) is silently ignored

### Tests required

| File | Scenarios |
|---|---|
| `__test__/feedback-handler.test.ts` | should parse `/explain` command; should parse `/dismiss` command; should ignore unknown body; should not respond when actor is bot; should not dismiss when allowDismiss is false; should post reply on explain; should edit comment and resolve thread on dismiss |
| `__test__/thread-resolver.test.ts` | should resolve threads whose findings are absent from new result; should leave open threads whose findings still appear; should post commit reference in resolution message; should update summary comment |
| `__test__/github.test.ts` (additions) | should extract FindingMetadata from valid HTML comment; should return null for body without metadata; should embed metadata at end of comment body; should replace existing metadata block |

### Verification commands

```bash
npm run build      # must exit 0 (TypeScript clean)
npm test           # vitest run — all suites green
```

Manual end-to-end test (requires a real repo with the workflow installed):
1. Open a PR with a known issue
2. Let `review-pr` post an inline comment
3. Reply `/explain` — verify a reply appears within ~30s
4. Reply `/dismiss` — verify thread is resolved and summary updates
5. Fix the flagged code and push — verify the thread auto-resolves

## 9. UX Criteria

### Loading / async

- The feedback workflow typically runs in <30s. No progress indicator is shown in GitHub (no mechanism for it). The developer sees the reply appear once the workflow completes.

### Responses

- `/explain` reply: plain prose, 3–5 sentences in the configured `language` from `.ai-review.yml`. Starts with _"Este hallazgo fue marcado porque..."_ (or English equivalent). No severity labels or JSON.
- `/dismiss` reply: _"Hallazgo descartado por @{actor}. Hilo resuelto."_ (or English equivalent based on `language` config). Posted before the thread is resolved so it's visible in the resolved thread.
- Auto-resolve reply: _"Corregido en {sha[:7]}. Hilo resuelto automáticamente."_

### Errors

- If the parent comment has no `ai-review-finding` metadata (e.g., dev replied to a human comment), silently exit 0 — no error reply.
- If OpenAI call fails during `/explain`, post a brief error reply: _"No se pudo generar la explicación. Intentá de nuevo."_ Do not leave the thread in a broken state.
- If GraphQL `resolveReviewThread` fails, log the error via `console.error` and continue — do not crash the workflow.

### Anti-bot loop protection

`FeedbackHandler.handle()` must compare `event.actor` against the GitHub Actions bot username (`github-actions[bot]`) and the `GITHUB_ACTOR` env var. If they match, exit 0 immediately.

## 10. Decisions Made (Locked)

| Decision | Why |
|---|---|
| State in HTML comments (not a DB or GitHub Issue) | Zero infrastructure; state travels with the comment; no external service required |
| Slash commands in replies only (not freeform text) | Unambiguous parsing; avoids false positives from normal discussion |
| Any participant can dismiss | Code review is a team conversation; restricting to PR author only would block reviewers from cleaning up their own findings |
| Auto-resolve checks only files changed in the current push | Re-running the full PR is expensive; targeted re-analysis per-file is sufficient and cheaper |
| GraphQL for thread resolution | REST API does not expose `resolveReviewThread`; GraphQL is the only option |
| `feedback.enabled` defaults to `false` | Feature is additive; existing users are unaffected until they opt in |
| Separate workflow (`handle-feedback.yml`) not merged into `ci.yml` | Different trigger (`pull_request_review_comment` vs `pull_request`); different permission surface |
| No `/reanalyze` command | Re-analysis on push already covers this use case; explicit command would duplicate behavior |

## 11. Edge Cases

### Invalid inputs

- Comment body is empty or whitespace → silently ignore (no reply)
- Comment body has `/explain` followed by extra text (e.g., `/explain please`) → treat as `/explain` (match prefix)
- Comment body has multiple slash commands → use the first one only
- Finding metadata JSON is malformed (truncated comment body) → `extractFindingMetadata()` returns `null`, exit silently

### API errors

| Status | Behavior |
|---|---|
| 401 | Log error, exit 1 (token invalid — workflow will show failure) |
| 403 | Log error, exit 1 (token missing `pull-requests: write`) |
| 404 | Silently exit 0 (comment or PR deleted before workflow ran) |
| 422 | Log warning, continue (thread already resolved) |
| 429 | Log warning, exit 1 (rate limited — let the workflow retry) |
| 500 | Log error, exit 1 |

### No connection / timeout

- OpenAI timeout during `/explain` → post error reply, exit 0 (don't fail the workflow visibly for the developer)
- GitHub API timeout → log error, exit 1

### Duplicate events

- GitHub may fire `pull_request_review_comment` twice for the same comment in rare cases → `FeedbackHandler` is idempotent on dismiss (re-editing metadata with same status is a no-op; `resolveThread` on an already-resolved thread returns 422 → see above)

### Auto-resolve: finding appears with different line after rebase

- Finding `id` is a hash of `file + line + message`. If a rebase shifts the line number, the id changes and the old thread will not auto-resolve. This is acceptable in this phase; the developer can dismiss manually.

### Push with no changed files overlapping with findings

- If the push touches no files that have open findings, `ThreadResolver` exits immediately after fetching comments (O(comments) check, no OpenAI calls).

## 12. Required UI States

| State | What is shown |
|---|---|
| `idle` | No bot reply; thread open |
| `/explain` in progress | Workflow running (GitHub Actions status visible) |
| `/explain` success | Bot reply with explanation in thread |
| `/explain` error | Bot reply: "No se pudo generar la explicación." |
| `/dismiss` success | Thread resolved; dismissal reply visible in resolved thread |
| `/dismiss` blocked (allowDismiss: false) | Bot reply: "El descarte de hallazgos está deshabilitado en la configuración." |
| Auto-resolve success | Thread resolved; auto-resolve reply visible |
| Feature disabled | No bot reaction to slash commands |

## 13. Validations

### Client validations

| Input | Rule | Behavior on violation |
|---|---|---|
| `event.actor` | Must not equal bot username | Exit 0 silently |
| Parent comment body | Must contain `<!-- ai-review-finding:` | Exit 0 silently |
| `FindingMetadata.status` | Must be `"open"` for dismiss to proceed | Reply: "Este hallazgo ya fue resuelto o descartado." |
| Slash command | Must be `/explain` or `/dismiss` (prefix match) | Exit 0 silently for unrecognized |

### Server validations

No server-side form validation. GitHub API errors are handled per Section 11.

## 14. Security & Permissions

- `GITHUB_TOKEN` requires `pull-requests: write` — explicitly set in `handle-feedback.yml` permissions block
- `OPENAI_API_KEY` is consumed only for `/explain`; not used for `/dismiss` or auto-resolve
- The bot must NEVER act on comments from itself (`github-actions[bot]`) to prevent infinite reply loops
- `FindingMetadata` is parsed from HTML comment content — the JSON must be parsed with `JSON.parse` inside a `try/catch`; malformed input exits silently (not thrown to the caller)
- The PR description and comment bodies are user-controlled — the explain prompt must NOT inject raw comment text into the system prompt as trusted instructions. Treat finding message and code context as `<user-data>` blocks in the prompt, not as system directives
- `dismissedBy` stores the GitHub actor login (visible to the team); no PII beyond the public username is stored
- `threadNodeId` is persisted in the metadata to avoid a second GraphQL lookup at resolve time; it is not sensitive

## 15. Observability & Logging

Use `console.error` for errors and `console.log` for key lifecycle events (same pattern as existing `reviewer.ts`). The `DEBUG` env var (already supported in `cli.ts`) enables stack traces.

What to log:
- Which slash command was detected
- Whether `feedback.enabled` is false (and early exit)
- OpenAI explain call duration
- Thread resolution success/failure per finding
- Summary comment edit success/failure

Never log:
- `OPENAI_API_KEY` or `GITHUB_TOKEN` values
- Full comment body content (may contain code)
- `FindingMetadata` JSON in production logs (log only the `id` and `status`)

## 16. i18n / User-facing copy

All bot replies respect the `language` key in `.ai-review.yml` (default: `"es"`). All reply strings are generated by the LLM for `/explain`, or templated for fixed messages. Templated strings must be parameterized (no hardcoded Spanish), controlled by the `language` config.

| Message | Spanish (es) | English (en) |
|---|---|---|
| Dismissal reply | `Hallazgo descartado por @{actor}. Hilo resuelto.` | `Finding dismissed by @{actor}. Thread resolved.` |
| Auto-resolve reply | `Corregido en {sha}. Hilo resuelto automáticamente.` | `Fixed in {sha}. Thread auto-resolved.` |
| Dismiss blocked | `El descarte de hallazgos está deshabilitado en la configuración.` | `Dismissing findings is disabled in the project configuration.` |
| Already resolved | `Este hallazgo ya fue resuelto o descartado.` | `This finding has already been resolved or dismissed.` |
| Explain error | `No se pudo generar la explicación. Intentá de nuevo.` | `Could not generate explanation. Please try again.` |

## 17. Performance

- `/explain` requires one OpenAI call with a small prompt (~500 tokens). Acceptable latency (<10s).
- Auto-resolve fetches all inline comments once per PR push. PRs with >100 comments may hit GitHub's per-page pagination — `GitHubClient` must paginate.
- `ThreadResolver` does NOT call OpenAI for each finding — it only checks if the finding id is absent from the new `ReviewResult`. O(comments × findings) comparison in memory.
- The feedback workflow does not cache npm dependencies in this phase (same decision as `ci.yml`). Add caching in a follow-up if cold-start time is a problem.

## 18. Restrictions

The implementer must NOT:

- [ ] Introduce new npm dependencies without updating `package.json` and `package-lock.json` and noting the addition in the PR
- [ ] Use `any` or `unknown` types without explicit narrowing
- [ ] Declare standalone functions at module scope (all logic in classes)
- [ ] Modify `src/openai.ts` — reuse `OpenAIClient` as-is
- [ ] Modify `src/tech-detect.ts` or any file in `templates/`
- [ ] Add `feedback` logic inside the `review-pr` command path beyond the `resolveFixedThreads()` call
- [ ] Store state in a file, database, or GitHub Issue — HTML comments only
- [ ] Log full API tokens or comment bodies in any log level
- [ ] Reply to comments where the actor is the bot (infinite loop prevention is mandatory)
- [ ] Change the shape of `ReviewFinding`, `ReviewResult`, or `ChangedFile` in `types.ts` — only add new types

## 19. Deliverables

- [ ] `src/github.ts` — refactored to `GitHubClient` class; existing functions preserved as class methods; `postReview()` returns `Promise<number>` (summary comment ID); 5 new methods added (`postReply`, `editComment`, `resolveThread`, `extractFindingMetadata`, `embedFindingMetadata`)
- [ ] `src/reviewer.ts` — updated to use `GitHubClient`; metadata embedded in inline comments; `resolveFixedThreads()` called after review
- [ ] `src/feedback-handler.ts` — `FeedbackHandler` class
- [ ] `src/thread-resolver.ts` — `ThreadResolver` class
- [ ] `.github/workflows/handle-feedback.yml` — feedback workflow
- [ ] `src/cli.ts` — `handle-feedback` command added
- [ ] `src/prompts.ts` — `buildExplainPrompt()` method
- [ ] `src/config.ts` — `feedback:` block parsed into `ReviewerConfig`
- [ ] `src/types.ts` — `FindingStatus`, `SlashCommand`, `FindingMetadata`, `FeedbackConfig`, `FeedbackEvent`, `ResolveFixedOptions`, `ExplainPromptOptions` added
- [ ] `package.json` + `package-lock.json` — `@octokit/graphql` added (`npm install @octokit/graphql`)
- [ ] `__test__/feedback-handler.test.ts` — all 7 test cases
- [ ] `__test__/thread-resolver.test.ts` — all 4 test cases
- [ ] `__test__/github.test.ts` additions — `GitHubClient` class tests; metadata extract/embed tests
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0

## 20. Final Agent Checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] `src/github.ts` refactored to `GitHubClient` class BEFORE adding new methods — all existing callers in `reviewer.ts` updated
- [ ] `postReview()` returns `Promise<number>` (summary comment ID) — not `Promise<void>`
- [ ] `Severity` in `FindingMetadata` uses the existing type alias — NOT promoted to an enum
- [ ] `@octokit/graphql` added to `package.json` and `package-lock.json`
- [ ] All new types in `types.ts` use `enum` for closed sets (`FindingStatus`, `SlashCommand`) — no scattered string literals
- [ ] `FeedbackHandler` and `ThreadResolver` receive all dependencies via constructor — no `new OpenAI()` or `new Octokit()` inside methods
- [ ] Anti-bot-loop guard is the FIRST check in `FeedbackHandler.handle()` — before any API call
- [ ] `extractFindingMetadata()` wraps `JSON.parse` in a `try/catch` that returns `null` on any error
- [ ] `resolveThread()` handles 422 (already resolved) without throwing
- [ ] Handle-feedback workflow has `permissions: pull-requests: write`
- [ ] `feedback.enabled` defaults to `false` in `config.ts`
- [ ] Bot does not reply when `feedback.enabled` is `false`
- [ ] Auto-resolve only processes comments on files changed in the current push (fetch all, then filter by changed files)
- [ ] `ThreadResolver` paginates when fetching PR comments (handles >100 comments)
- [ ] All reply strings are language-aware (follow `config.language`)
- [ ] No modified files outside the list in Section 6
- [ ] `npm run build` → exit 0
- [ ] `npm test` → all suites green
- [ ] No `any` or `unknown` in new or modified files
- [ ] No standalone functions at module scope in new files
