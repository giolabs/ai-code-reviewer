# Auto Feedback Evaluation

> **Status:** PENDING PROPOSAL/CHANGE — no OpenSpec change has been generated yet. Run `/openspec-propose` (or `/opsx:propose`) using this spec as input.

## 1. Goal

When a developer replies to a bot inline comment with **free-form text** (not a `/explain` or `/dismiss` slash command), the system automatically evaluates whether the finding is still valid given the developer's context, fetches the current state of the affected file at the PR HEAD, and posts an intelligent reply in the thread — either acknowledging the fix and resolving the thread, or maintaining the finding with additional context.

This closes the feedback loop that was left open: today, any reply that is not a recognized slash command is silently ignored.

---

## 2. Scope

### Included in this phase

- Detect non-slash-command replies to bot inline comments and route them to a new `handleFeedbackEvaluation()` path inside `FeedbackHandler`
- Fetch the content of the affected file at the PR HEAD commit using a new `GitHubClient.getFileAtRef()` method
- Build an evaluation prompt with: the original finding, the developer's reply, and the relevant file content window around the finding line
- Call the LLM with `json_schema` response format returning `FeedbackEvaluationResult { decision: 'resolved' | 'maintained', reply: string }`
- Post the LLM-generated `reply` to the thread
- When `decision === 'resolved'`: update the finding metadata status to `FindingStatus.Resolved`, edit the parent comment body, and call `resolveThread()`
- When `decision === 'maintained'`: post the reply only; thread stays open; metadata unchanged
- Extend `getReviewCommentEventFromEnv()` return type to include `headSha` (read from `event.pull_request.head.sha`)
- Extend `FeedbackEvent` with `headSha?: string`
- Console log line per evaluation

### Out of scope

- Changes to `/explain` or `/dismiss` behavior — those routes are unchanged
- Retroactive evaluation of comments posted before this feature ships
- Cross-PR learning or memory of prior evaluations
- Config flag for this behavior — it activates automatically when `feedback.enabled: true`
- Changing `FeedbackHandler.handle()` for replies to non-bot comments
- Updating `handle-feedback.ts` CLI entry point — no signature change needed
- Modifying the `ThreadResolver` class — thread resolution goes through `GitHubClient.resolveThread()` directly, already used in `handleDismiss()`
- Replies where `inReplyToId` is `null` (already filtered in `handle()` before this path is reached)
- Evaluation of replies to the bot's own evaluation replies (infinite loop guard: `isBot()` check already exists)

---

## 3. Technologies & Conventions

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js `>=18.0.0`
- **Package manager**: npm
- **Build**: `tsc` → `dist/`
- **Test**: Vitest (`npm test` → `vitest run`)
- **GitHub API (REST)**: `@octokit/rest ^21.0.0` — `repos.getContent` for file fetch
- **LLM**: multi-provider via `createLLMAdapter()` in `src/llm/factory.ts`; `FeedbackHandler` receives the LLM call via constructor injection as `llmCall: (prompt: string) => Promise<string>` (defined in `FeedbackHandlerOptions`, line 11 of `src/feedback-handler.ts`). For structured output, the evaluation prompt instructs the model to return **only** a JSON object matching `FeedbackEvaluationResult`. The implementer calls `this.llmCall(prompt)` and then `JSON.parse`s the string — schema enforcement is prompt-level, not API-level. This is the same trade-off accepted in `handleExplain()` for free-text output; it is the correct pattern given the existing DI contract.
- **No new dependencies**

### Relevant versions (from `package.json`)

| Field | Value |
|---|---|
| `version` | `0.1.0-beta.7` |
| `node` engine | `>=18.0.0` |
| `typescript` | `^5.6.0` |
| `vitest` | `^3.2.6` |
| `@octokit/rest` | `^21.0.0` |
| `openai` | `^4.67.0` |
| `@anthropic-ai/sdk` | `^0.39.0` |

### Existing patterns to follow

- `src/feedback-handler.ts` — `FeedbackHandler.handleDismiss()` and `handleExplain()` are the canonical patterns for new handler methods; follow exactly: get parent comment → extract metadata → call LLM/action → post reply
- `src/github.ts` — `getFileContent(ctx, path, ref)` (lines 129–150) is the template for `getFileAtRef()`; `getReviewCommentEventFromEnv()` (line 560+) is the template for the headSha extension
- `src/prompts.ts` — `buildExplainPrompt()` is the pattern for `buildFeedbackEvaluationPrompt()`; follow the same `PromptBuilder` method style
- `src/types.ts` — `FeedbackEvaluationResult` and `FeedbackEvaluationDecision` follow the existing `ReviewResult` / `Severity` / `SlashCommand` patterns (enum for closed sets, interface for result shapes)
- `__test__/feedback-handler.test.ts` — existing tests; extend with new `describe('handleFeedbackEvaluation')` block

---

## 4. Prerequisites

- [x] `FeedbackHandler` exists in `src/feedback-handler.ts` with `handle()`, `handleExplain()`, `handleDismiss()`, `parseSlashCommand()`, `postReply()`
- [x] `GitHubClient.getReviewComment(owner, repo, commentId)` exists in `src/github.ts`
- [x] `GitHubClient.extractFindingMetadata(body)` exists in `src/github.ts`
- [x] `GitHubClient.embedFindingMetadata(body, metadata)` exists in `src/github.ts`
- [x] `GitHubClient.editComment({ owner, repo, commentId, body, isPrReviewComment })` exists
- [x] `GitHubClient.resolveThread({ threadNodeId })` exists
- [x] `GitHubClient.postReply({ owner, repo, pullNumber, commentId, body })` exists
- [x] `FindingStatus.Resolved` exists in `src/types.ts`
- [x] `SlashCommand.Unknown` exists in `src/types.ts`
- [x] `getReviewCommentEventFromEnv()` reads from `GITHUB_EVENT_PATH` in `src/github.ts`
- [x] `FeedbackEvent` interface exists in `src/types.ts`
- [x] `createLLMAdapter()` exists in `src/llm/factory.ts`
- [ ] `GitHubClient.getFileAtRef({ owner, repo, path, ref })` — **does not exist yet** (created in this spec)
- [ ] `FeedbackEvaluationDecision` type — **does not exist yet**
- [ ] `FeedbackEvaluationResult` interface — **does not exist yet**
- [ ] `FeedbackHandler.handleFeedbackEvaluation()` — **does not exist yet**
- [ ] `PromptBuilder.buildFeedbackEvaluationPrompt()` — **does not exist yet**
- [ ] `headSha` field in `getReviewCommentEventFromEnv()` return type — **does not exist yet**
- [ ] `headSha?: string` in `FeedbackEvent` — **does not exist yet**

---

## 5. Architecture

**Pattern**: Extension of the existing `FeedbackHandler` strategy. No new class, no new CLI command.

### Affected layers

| Layer | Changed | Description |
|---|---|---|
| `src/feedback-handler.ts` | yes | Change `Unknown` early-return to `handleFeedbackEvaluation()`; add private method |
| `src/prompts.ts` | yes | Add `buildFeedbackEvaluationPrompt()` to `PromptBuilder` |
| `src/types.ts` | yes | Add `FeedbackEvaluationDecision` type and `FeedbackEvaluationResult` interface; extend `FeedbackEvent` |
| `src/github.ts` | yes | Add `getFileAtRef()`; extend `getReviewCommentEventFromEnv()` return type to include `headSha` |
| `src/handle-feedback.ts` | yes | Extend `FeedbackEvent` construction to include `headSha` from `rawEvent` |
| `src/cli.ts` | no | No changes |
| `src/config.ts` | no | No new config keys |
| `src/reviewer.ts` | no | No changes |

### Expected flow — free-form reply

1. Developer posts a reply to a bot inline comment (not `/explain`, not `/dismiss`)
2. GitHub emits `pull_request_review_comment` event → `handle-feedback` CI job fires
3. `handle-feedback.ts` reads event via `getReviewCommentEventFromEnv()` (now also reads `headSha`)
4. Constructs `FeedbackEvent` including `headSha`
5. `FeedbackHandler.handle(event)` is called
6. `isFeedbackEnabled()` → true, `isBot()` → false (dev, not bot)
7. `parseSlashCommand(event.commentBody)` → `SlashCommand.Unknown`
8. **New path**: call `this.handleFeedbackEvaluation(event)` instead of returning
9. Inside `handleFeedbackEvaluation()`:
   a. Fetch parent comment via `getReviewComment(owner, repo, event.inReplyToId)`
   b. Extract metadata via `extractFindingMetadata(parentComment.body)` — if null, return silently
   c. Fetch file content via `getFileAtRef({ owner, repo, path: metadata.file, ref: event.headSha ?? 'HEAD' })`
   d. Extract a ±50-line window centered on `metadata.line` from file content (max 3000 chars)
   e. Build prompt via `promptBuilder.buildFeedbackEvaluationPrompt({ finding, devReply, fileWindow, language })`
   f. Call LLM: `const raw = await this.llmCall(prompt)` — `llmCall` returns `Promise<string>`. Parse the result: `const result: FeedbackEvaluationResult = JSON.parse(raw)`. If `JSON.parse` throws or the parsed object lacks `decision`/`reply`, treat as an LLM error (§11 edge case).
   g. Post `result.reply` to the thread via `postReply()`
   h. If `result.decision === 'resolved'`:
      - Update metadata: `status → FindingStatus.Resolved`
      - Edit parent comment body with updated metadata via `editComment()`
      - Call `resolveThread({ threadNodeId: metadata.threadNodeId })`
10. Log evaluation outcome to console

### Layout of new code

No new files in `src/`. All changes are additions to existing files.

```
src/
  types.ts                  ← add: FeedbackEvaluationDecision, FeedbackEvaluationResult, headSha in FeedbackEvent
  github.ts                 ← add: getFileAtRef(); extend getReviewCommentEventFromEnv() return type
  handle-feedback.ts        ← extend FeedbackEvent construction with headSha
  prompts.ts                ← add: buildFeedbackEvaluationPrompt() to PromptBuilder
  feedback-handler.ts       ← change Unknown early-return; add handleFeedbackEvaluation()
__test__/
  feedback-handler.test.ts  ← extend with handleFeedbackEvaluation describe block
  github.test.ts            ← extend with getFileAtRef tests
  prompts.test.ts           ← extend with buildFeedbackEvaluationPrompt tests
```

---

## 6. Files to Create / Modify

| Path | Action | Purpose | Follow |
|---|---|---|---|
| `src/types.ts` | MODIFY | Add `FeedbackEvaluationDecision`, `FeedbackEvaluationResult`, `headSha?` to `FeedbackEvent` | Existing type/interface declarations in same file |
| `src/github.ts` | MODIFY | Add `getFileAtRef()`; extend `getReviewCommentEventFromEnv()` return type | `getFileContent()` (line 129) and `getReviewCommentEventFromEnv()` (line 560) |
| `src/handle-feedback.ts` | MODIFY | Add `headSha: rawEvent.headSha` to `FeedbackEvent` construction | Existing construction block in same file |
| `src/prompts.ts` | MODIFY | Add `buildFeedbackEvaluationPrompt()` | `buildExplainPrompt()` in same file |
| `src/feedback-handler.ts` | MODIFY | Replace `Unknown` early-return with `handleFeedbackEvaluation()` call; add private method | `handleDismiss()` and `handleExplain()` in same file |
| `__test__/feedback-handler.test.ts` | MODIFY | New `describe('handleFeedbackEvaluation')` block | Existing `describe` blocks in same file |
| `__test__/github.test.ts` | MODIFY | Tests for `getFileAtRef()` and `headSha` in event parsing | Existing `describe('GitHubClient')` block |
| `__test__/prompts.test.ts` | MODIFY | Tests for `buildFeedbackEvaluationPrompt()` | Existing `describe('PromptBuilder')` block |

### Detail per file

#### `src/types.ts`

**Responsibility**: Define the closed-set decision type and the structured LLM result; extend `FeedbackEvent`.

```typescript
export type FeedbackEvaluationDecision = 'resolved' | 'maintained';

export interface FeedbackEvaluationResult {
  decision: FeedbackEvaluationDecision;
  reply: string;
}
```

Extend `FeedbackEvent`:
```typescript
export interface FeedbackEvent {
  // ... existing fields unchanged ...
  /** SHA of the PR's HEAD commit at the time of the reply event */
  headSha?: string;
}
```

**Do not mix in**: Any review or config types.

---

#### `src/github.ts`

**Responsibility**: Two additions:

1. **`GitHubClient.getFileAtRef(args: { owner: string; repo: string; path: string; ref: string }): Promise<string | null>`**
   - Calls `this.octokit.repos.getContent({ owner, repo, path, ref })`
   - Returns `null` if array response, non-file type, no `content` field, or any error
   - Returns `Buffer.from(data.content, 'base64').toString('utf-8')` on success
   - Follow: `getFileContent()` in same file (identical logic, without `PullRequestContext` dependency)

2. **Extend `getReviewCommentEventFromEnv()` return type** to add `headSha: string`:
   - Read from `ev.pull_request?.head?.sha as string` — default to `''` if absent
   - The existing return object gains one more field: `headSha: (pr?.head as Record<string, unknown>)?.sha as string ?? ''`

**Do not mix in**: New classes, changes to any existing method bodies beyond the one extension to `getReviewCommentEventFromEnv()`.

---

#### `src/handle-feedback.ts`

**Responsibility**: Pass `headSha` from `rawEvent` into `FeedbackEvent`.

The existing construction:
```typescript
const event: FeedbackEvent = {
  actor: rawEvent.actor,
  commentId: rawEvent.commentId,
  commentBody: rawEvent.commentBody,
  inReplyToId: rawEvent.inReplyToId,
  pullNumber: rawEvent.pullNumber,
  repo: rawEvent.repo,
  owner: rawEvent.owner,
};
```
Becomes:
```typescript
const event: FeedbackEvent = {
  actor: rawEvent.actor,
  commentId: rawEvent.commentId,
  commentBody: rawEvent.commentBody,
  inReplyToId: rawEvent.inReplyToId,
  pullNumber: rawEvent.pullNumber,
  repo: rawEvent.repo,
  owner: rawEvent.owner,
  headSha: rawEvent.headSha,
};
```

**Do not mix in**: Logic or LLM calls.

---

#### `src/prompts.ts`

**Responsibility**: Add `buildFeedbackEvaluationPrompt()` to `PromptBuilder`.

New interface (in `src/types.ts`, following all other prompt-arg interfaces):
```typescript
interface FeedbackEvaluationPromptArgs {
  findingTitle: string;
  findingDescription: string;
  findingSeverity: string;
  findingFile: string;
  findingLine: number;
  devReply: string;
  fileWindow: string;
  language: 'es' | 'en';
}
```

The prompt must:
- Describe the original finding (severity, file, line, title, description)
- Show the developer's reply verbatim
- Show the relevant file content window (labeled "Current file state around line N")
- Instruct the LLM to decide: if the finding is genuinely fixed or the dev's argument is correct → `resolved`; if the finding still applies → `maintained`
- Ask the LLM to write a short, respectful reply in `language` to post in the thread
- Return a JSON object matching `FeedbackEvaluationResult`

Follow: `buildExplainPrompt()` for the single-string return style.

---

#### `src/feedback-handler.ts`

**Responsibility**: Replace the `Unknown` silent exit with the evaluation path.

**Change in `handle()`** — current code:
```typescript
const command = this.parseSlashCommand(event.commentBody);
if (command === SlashCommand.Unknown) return;
```

New code:
```typescript
const command = this.parseSlashCommand(event.commentBody);
if (command === SlashCommand.Unknown) {
  await this.handleFeedbackEvaluation(event);
  return;
}
```

**New private method** `handleFeedbackEvaluation(event: FeedbackEvent): Promise<void>`:
1. Fetch parent comment: `getReviewComment(owner, repo, inReplyToId!)`; if null, return silently
2. Extract metadata: `extractFindingMetadata(parentComment.body)`; if null, return silently
3. Fetch file at HEAD: `this.githubClient.getFileAtRef({ owner, repo, path: metadata.file, ref: event.headSha ?? 'HEAD' })`; `fileContent` may be null
4. Extract line window: if `fileContent` is non-null, slice ±50 lines centered on `metadata.line`; cap at 3000 chars
5. Build prompt: `promptBuilder.buildFeedbackEvaluationPrompt({ findingTitle, findingDescription, ..., devReply: event.commentBody, fileWindow, language: config.language })`

   > Note: `FindingMetadata` in `types.ts` does not have a `title` or `description` field. Extract them from the parent comment body using `extractCodeContextFromBody()` (private method at line 153 of `src/feedback-handler.ts`). The format of a bot inline comment is: the human-readable text (title + description) appears **before** the `<!-- ai-review-finding:...-->` HTML comment. Split on that delimiter: everything before it is the finding display text. The **first non-empty line** of that text is the title (e.g., `🔴 **CRITICAL** · \`security\` · Falta de verificación de firma en JWT`). All remaining lines are the description. Use the first 500 chars of the description to avoid prompt bloat.

6. Call LLM and parse result as `FeedbackEvaluationResult`
7. `postReply(event, result.reply)`
8. If `result.decision === 'resolved'`:
   - `updatedMetadata = { ...metadata, status: FindingStatus.Resolved }`
   - `editComment({ owner, repo, commentId: event.inReplyToId!, body: embedFindingMetadata(parentComment.body, updatedMetadata), isPrReviewComment: true })`
   - If `metadata.threadNodeId` is non-empty: `resolveThread({ threadNodeId: metadata.threadNodeId })`
9. Log: `console.log(chalk.dim(\`Evaluación de feedback: ${result.decision}\`))`

**Do not mix in**: Changes to `handleExplain()`, `handleDismiss()`, `parseSlashCommand()`, or `isFeedbackEnabled()`.

---

## 7. API Contract

No new external API surface for CLI consumers. Internally, this feature uses one additional GitHub REST endpoint:

- `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}` — to fetch the current file content at the PR HEAD (`octokit.repos.getContent`)

No `api-contract.md` needed.

---

## 8. Success Criteria

- [ ] A free-form reply to a bot inline comment triggers `handleFeedbackEvaluation()` — not a silent return
- [ ] `/explain` and `/dismiss` replies are unaffected by this change
- [ ] The LLM receives the finding details, the developer's reply, and the file content window
- [ ] When `decision === 'resolved'`: the bot posts the reply, the parent comment metadata is updated to `FindingStatus.Resolved`, and the thread is resolved
- [ ] When `decision === 'maintained'`: the bot posts the reply only; metadata and thread state are unchanged
- [ ] When `getFileAtRef()` returns null (file not found / deleted): `fileWindow` is an empty string and the evaluation still proceeds
- [ ] `feedback.enabled: false` in config prevents evaluation (via existing `isFeedbackEnabled()` guard)
- [ ] Console logs the evaluation decision
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0

### Required tests

| Test file | Scenarios |
|---|---|
| `__test__/feedback-handler.test.ts` | `handleFeedbackEvaluation`: should call LLM and post reply when dev sends free-form text; should resolve thread and update metadata when decision is 'resolved'; should only post reply (no thread resolve) when decision is 'maintained'; should return silently when parent comment has no finding metadata; should return silently when inReplyToId is null; `/explain` and `/dismiss` should NOT trigger evaluation path |
| `__test__/github.test.ts` | `getFileAtRef`: returns null when API returns array; returns null on error; returns decoded content string on success. `getReviewCommentEventFromEnv`: includes headSha in returned object when pull_request.head.sha is present; headSha is empty string when absent |
| `__test__/prompts.test.ts` | `buildFeedbackEvaluationPrompt`: includes finding title and description; includes developer reply; includes file content window; uses correct language instruction |

### Verification commands

```bash
npm run build    # must exit 0
npm test         # must exit 0
```

---

## 9. UX Criteria

No web UI. Console output only.

**Normal evaluation (reply received):**
```
Evaluación de feedback: maintained
```

**Finding resolved by evaluation:**
```
Evaluación de feedback: resolved
✓ Feedback handled.
```

**Silent exit (no metadata on parent):**
*(no output — same behavior as replies to non-bot comments today)*

Bot reply examples (posted in GitHub thread):

*Decision: maintained (es):*
> Gracias por el contexto. Revisé el archivo actual en `src/auth/jwt.ts` línea 42 y el hallazgo sigue siendo válido: la firma del token no se verifica antes de decodificar el payload. El contexto que mencionás aplica al flujo de refresh, pero el endpoint de verificación directo permanece sin protección.

*Decision: resolved (es):*
> Confirmado — revisé el código actual y el fix está aplicado. Hilo resuelto.

---

## 10. Decisions Made (Locked)

| Decision | Why |
|---|---|
| Evaluate only non-slash-command replies | `/explain` and `/dismiss` already have well-defined semantics. Mixing evaluation into those paths would create ambiguity and risk breaking existing behavior. |
| Structured JSON `{ decision, reply }` via `json_schema` | Consistent with the rest of the project's LLM calls. Prevents parsing failures on ambiguous free-text responses. |
| Evaluate against PR HEAD commit (`headSha`) | The developer is responding in the current context of the PR. Evaluating against the original finding commit would compare against possibly stale code. |
| Activate automatically when `feedback.enabled: true`, no new config flag | The evaluation is the natural completion of the feedback feature. Adding a flag increases configuration surface without meaningful benefit — repos that want the old behavior can set `feedback.enabled: false`. |
| On `resolved`: post reply + update metadata + resolve thread | Mirrors the `/dismiss` behavior for consistency. The developer can always reopen if needed. |
| On `maintained`: post reply only, no metadata change | The finding remains open. The thread stays visible. The bot does not auto-dismiss findings it still considers valid — human review is required. |
| `findingTitle` extracted from comment body text, not stored in `FindingMetadata` | `FindingMetadata` schema does not have a `title` field and adding one would require migrating all existing embedded metadata blobs. The comment body already contains the human-readable title text before the HTML comment. |
| File content capped at 3000 chars, ±50 lines centered on finding line | Balances context richness vs token cost. Mirrors the approach used in `buildExplainPrompt()`. |

---

## 11. Edge Cases

### Developer reply to the bot's own evaluation reply

`isBot()` returns `true` for `github-actions[bot]` — the guard in `handle()` fires before `parseSlashCommand()`, so evaluation is never triggered on bot-to-bot threads. No change needed.

### Parent comment has no `<!-- ai-review-finding:... -->` metadata

`extractFindingMetadata()` returns null → `handleFeedbackEvaluation()` returns silently. The developer may have replied to a non-finding bot comment (e.g., a summary comment). Correct behavior.

### File referenced in finding was deleted from the PR

`getFileAtRef()` returns null → `fileWindow = ''` → LLM receives the finding and dev reply but no file content. The prompt must handle this gracefully: instruct the LLM that the file content is unavailable. The evaluation still runs; the LLM will likely lean toward `resolved` on missing files.

### Finding line number no longer exists in the file

File content fetched successfully but `metadata.line` exceeds `fileContent.split('\n').length`. Extract the full file content (capped at 3000 chars from the start) instead of a line window.

### `metadata.threadNodeId` is empty or missing

`handleDismiss()` already guards: `if (metadata.threadNodeId)`. Apply the same guard in `handleFeedbackEvaluation()` — skip `resolveThread()` if `threadNodeId` is falsy, but still post the reply and update the metadata status.

### LLM returns a malformed response (not matching `FeedbackEvaluationResult` schema)

The adapter's `json_schema` enforcement should prevent this. If the adapter throws or returns an unusable result: catch the error, post a fallback reply (config-language-aware: "No pude evaluar el comentario. Por favor, revisá manualmente."), and return without touching the thread state.

### `event.headSha` is undefined (old event format or missing field)

Fall back to `'HEAD'` as the ref for `getFileAtRef()`. GitHub will resolve `HEAD` to the default branch, which may differ from the PR HEAD — acceptable degraded behavior.

### `feedback.enabled` is false

`isFeedbackEnabled()` returns false → `handle()` returns at the top before reaching `handleFeedbackEvaluation()`. No change needed.

---

## 12. Required UI States

Not applicable — CLI/CI tool with no web UI.

---

## 13. Validations

No user-supplied form input. Guard clauses only:

- `isFeedbackEnabled()`: returns false if `config.feedback?.enabled !== true`
- `isBot(event.actor)`: returns true for `github-actions[bot]` or `GITHUB_ACTOR` env value
- `event.inReplyToId === null`: silently skipped (guard already exists in `handle()`)
- `extractFindingMetadata(parentComment.body) === null`: silently skipped
- `getFileAtRef()` returning null: sets `fileWindow = ''`, evaluation continues
- LLM error/malformed response: post fallback reply, return without thread mutation

---

## 14. Security & Permissions

- No new GitHub permissions required: `pull-requests: write` (already granted) covers `repos.getContent` read + `postReply` + `editComment` + `resolveThread`
- `event.commentBody` (the developer's reply) is passed to the LLM as user content — it is developer-supplied text; the LLM prompt must never interpolate it into shell commands or code executed on the runner
- `metadata.file` (the file path to fetch) comes from the bot's own embedded metadata, not from the developer's reply — not attacker-controlled
- `event.headSha` is a commit SHA from the GitHub event payload — safe to use as a `ref`
- `GITHUB_TOKEN` is never logged — existing behavior unchanged
- No new environment variables required

---

## 15. Observability & Logging

**Log (new lines, in rioplatense Spanish):**

| When | Output |
|---|---|
| Evaluation starts | `chalk.dim('Evaluando respuesta del desarrollador...')` |
| LLM returns decision | `chalk.dim(\`Evaluación de feedback: ${result.decision}\`)` |
| Thread resolved | `chalk.green('✓ Thread resuelto por evaluación de feedback.')` |
| File not found | `chalk.dim('Archivo no encontrado en HEAD del PR. Evaluando sin contenido de archivo.')` |
| LLM error | `chalk.yellow('⚠ No se pudo evaluar el feedback. Posteando respuesta de fallback.')` |

**Never log:**
- `event.commentBody` (developer's reply — may contain sensitive business context)
- Full file content
- Finding description text
- `headSha` is safe to log but not needed

**Mechanism**: `chalk` via `console.log()` — same as all existing output in `src/feedback-handler.ts`.

---

## 16. i18n / User-Facing Copy

All CLI output is rioplatense Spanish. Bot replies (posted to GitHub) are generated by the LLM in `config.language` — the prompt instructs the language explicitly.

| Location | String |
|---|---|
| `src/feedback-handler.ts` | `'Evaluando respuesta del desarrollador...'` |
| `src/feedback-handler.ts` | `` `Evaluación de feedback: ${result.decision}` `` |
| `src/feedback-handler.ts` | `'✓ Thread resuelto por evaluación de feedback.'` |
| `src/feedback-handler.ts` | `'Archivo no encontrado en HEAD del PR. Evaluando sin contenido de archivo.'` |
| `src/feedback-handler.ts` | `'⚠ No se pudo evaluar el feedback. Posteando respuesta de fallback.'` |
| Fallback bot reply (es) | `'No pude evaluar el comentario. Por favor, revisá el hallazgo manualmente.'` |
| Fallback bot reply (en) | `'Could not evaluate this comment. Please review the finding manually.'` |
| LLM prompt instruction | Language-specific directive in `buildFeedbackEvaluationPrompt()` (model-facing, not user-facing) |

---

## 17. Performance

- **Extra API calls per reply event**: `getReviewComment()` (1 call, already in dismiss/explain paths) + `getFileAtRef()` (1 new call, ~200ms typical). Acceptable for an event-driven CI job.
- **File content**: capped at 3000 chars (±50 lines around finding line). No large-file risk.
- **LLM token cost**: finding description + dev reply + file window → estimated ~800–1500 input tokens. Comparable to `/explain` path. Single call.
- **No caching**: each reply event is independent; no state between runs.
- **No debouncing needed**: `pull_request_review_comment` events fire once per comment. No burst risk.

---

## 18. Restrictions

The implementer must NOT:

- [ ] Change the behavior of `handleExplain()` or `handleDismiss()`
- [ ] Add any new npm dependencies
- [ ] Add a config flag for this feature (it is unconditionally on when `feedback.enabled: true`)
- [ ] Call `resolveThread()` when `decision === 'maintained'`
- [ ] Call `ThreadResolver.resolveFixed()` — use `GitHubClient.resolveThread()` directly (same as `handleDismiss()`)
- [ ] Add `title` to `FindingMetadata` (would require migrating embedded metadata blobs)
- [ ] Change `postReview()`, `getPullRequestContextFromEnv()`, `buildSystemPrompt()`, or `buildUserPrompt()` signatures
- [ ] Export `handleFeedbackEvaluation` as a public method or function
- [ ] Refactor `callLLM()` or `createLLMAdapter()` — use the existing `llmCall` injection in `FeedbackHandler`

---

## 19. Deliverables

- [ ] `src/types.ts` — `FeedbackEvaluationDecision`, `FeedbackEvaluationResult`, `headSha?` in `FeedbackEvent`
- [ ] `src/github.ts` — `getFileAtRef()` added; `getReviewCommentEventFromEnv()` extended with `headSha`
- [ ] `src/handle-feedback.ts` — `headSha: rawEvent.headSha` added to `FeedbackEvent` construction
- [ ] `src/prompts.ts` — `buildFeedbackEvaluationPrompt()` added to `PromptBuilder`
- [ ] `src/feedback-handler.ts` — `Unknown` guard replaced with `handleFeedbackEvaluation()` call; private method implemented
- [ ] `__test__/feedback-handler.test.ts` — 6+ new tests in `handleFeedbackEvaluation` describe block
- [ ] `__test__/github.test.ts` — 5 new tests for `getFileAtRef()` and `headSha` extraction
- [ ] `__test__/prompts.test.ts` — 4 new tests for `buildFeedbackEvaluationPrompt()`
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0

---

## 20. Final Agent Checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] `FeedbackEvaluationDecision` is `'resolved' | 'maintained'` (not an enum — follows existing `Severity` pattern as a type alias)
- [ ] `FeedbackEvaluationResult` interface has exactly `decision` and `reply` fields
- [ ] `FeedbackEvent.headSha` is `string | undefined` (optional, not required)
- [ ] `getFileAtRef()` accepts a single typed options object (not positional params — follows CLAUDE.md)
- [ ] `getReviewCommentEventFromEnv()` returns `headSha: string` (empty string if absent, not null/undefined)
- [ ] `handleFeedbackEvaluation()` is a `private` method — not exported
- [ ] The `Unknown` path in `handle()` now calls `handleFeedbackEvaluation()` and returns, not just returns
- [ ] `handleFeedbackEvaluation()` returns silently (not throws) when parent comment has no metadata
- [ ] `handleFeedbackEvaluation()` uses `event.headSha ?? 'HEAD'` as fallback ref
- [ ] File content window is capped at 3000 chars
- [ ] When `decision === 'resolved'`: metadata status updated to `FindingStatus.Resolved`, comment edited, thread resolved
- [ ] When `decision === 'maintained'`: only reply posted, no metadata or thread mutation
- [ ] LLM call uses `this.llmCall(prompt)` (not a new adapter method); result is `JSON.parse`d into `FeedbackEvaluationResult`
- [ ] `JSON.parse` failure is caught in the same try/catch as `this.llmCall` rejection → fallback reply
- [ ] LLM error is caught and fallback reply is posted — no uncaught throw
- [ ] All console output strings match §15 and §16 exactly
- [ ] No new npm dependencies added
- [ ] Modified only the files listed in §6
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] No temporary logs or debugging code left
- [ ] No unjustified TODOs
