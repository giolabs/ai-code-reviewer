# @botai command system

## Objetivo

Replace the `/explain` and `/dismiss` slash commands with a structured `@botai <command>` system that allows developers to interact with the AI reviewer directly from inline PR comment threads, triggering approval, LLM-based evaluation, or immediate resolution of findings.

## Alcance

### Incluido en esta fase

- Parse `@botai approved | review | resolved` from PR review comment bodies (case-insensitive).
- `@botai approved`: post a reply in the thread and submit a GitHub APPROVE review on the PR.
- `@botai review """text"""`: call the LLM to evaluate whether `text` addresses the finding; post the LLM's decision as a reply; resolve the thread if the decision is `resolved`.
- `@botai resolved`: immediately mark the finding as resolved, update its metadata, resolve the thread, and auto-approve the PR if no other open bot findings remain.
- Always post a comment before or after taking any action.
- Remove `/explain` and `/dismiss` completely — no backwards compatibility.
- Add `submitApprovalReview` and `countOpenBotFindings` methods to `GitHubClient`.
- Update all tests.

### Fuera de scope

- `@botai` commands in general PR issue comments (`issue_comment` event) — only `pull_request_review_comment` is supported.
- Backwards compatibility with `/explain` or `/dismiss`.
- New workflow triggers beyond the existing `pull_request_review_comment` event.

## Tecnologías y convenciones del proyecto

- TypeScript ESM (`"type": "module"`, `.js` imports).
- `GitHubClient` class via Octokit REST + GraphQL.
- `FeedbackHandler` class with injected `llmCall` dependency.
- Vitest for tests (AAA pattern, one class per file).

## Arquitectura

### BotCommand parsing

`parseBotCommand(body: string): BotCommandParseResult` — regex `/@botai\s+(approved|review|resolved)/i`. For `review`, also extracts text between `"""..."""` delimiters.

### Routing in `handle()`

1. `unknown` → silent return.
2. `approved` → `handleApproved(event)` (does not need parent comment).
3. `review` / `resolved` → fetch parent comment → extract metadata → route.

### `handleApproved`

1. Post reply: "@actor aprobó este PR."
2. Call `submitApprovalReview`.

### `handleReview`

1. Fetch file at HEAD.
2. Build `buildFeedbackEvaluationPrompt` with `reviewText` from the `"""..."""` block.
3. Call LLM → parse JSON `{ decision, reply }`.
4. Post reply.
5. If `resolved`: `markResolved` (edit comment metadata + resolve thread).

### `handleResolved`

1. Post reply: "Hallazgo resuelto por @actor."
2. `markResolved`.
3. `countOpenBotFindings` — if 0 → `submitApprovalReview`.

## Archivos modificados

| Ruta | Acción | Propósito |
|------|--------|-----------|
| `src/types.ts` | MODIFICAR | Remove `SlashCommand`, `ExplainPromptOptions`; add `BotCommand`, `BotCommandParseResult` |
| `src/prompts.ts` | MODIFICAR | Remove `buildExplainPrompt` and `ExplainPromptOptions` import |
| `src/github.ts` | MODIFICAR | Add `submitApprovalReview`, `countOpenBotFindings` |
| `src/feedback-handler.ts` | MODIFICAR | Replace slash-command routing with `@botai` parsing; replace `handleExplain`/`handleDismiss`/`handleFeedbackEvaluation` with `handleApproved`/`handleReview`/`handleResolved`/`markResolved` |
| `__test__/feedback-handler.test.ts` | MODIFICAR | Replace all old tests with `@botai` tests |
| `__test__/github.test.ts` | MODIFICAR | Add tests for `submitApprovalReview`, `countOpenBotFindings` |

## Decisiones tomadas

- **Only `pull_request_review_comment` trigger**: keeps the surface small; `@botai approved` works from any inline thread reply even though it applies to the whole PR.
- **`@botai review` requires `"""`**: explicit delimiter prevents ambiguous text from being sent to the LLM.
- **`@botai unknown_command` → silent ignore**: no error message, to avoid bot noise for typos.
- **Auto-approve on `@botai resolved`**: checks `countOpenBotFindings` after marking current finding resolved; if 0 remaining → submit APPROVE review.
- **`submitApprovalReview` swallows errors**: consistent with other `GitHubClient` methods that warn instead of throw.

## Criterios de éxito

- [x] `@botai approved` posts reply + submits APPROVE review.
- [x] `@botai review """text"""` calls LLM with extracted text; posts reply; resolves thread if decision is `resolved`.
- [x] `@botai resolved` posts reply, updates metadata, resolves thread, auto-approves if 0 open findings remain.
- [x] Unknown text / no `@botai` → silent ignore.
- [x] All 175 tests pass.
- [x] TypeScript build clean.
