# General code review rules

## Security
- Unvalidated/unsanitized user inputs → minor or major depending on context.
- Hardcoded secrets (API keys, passwords, tokens) → critical.
- SQL/command injection, path traversal, XSS, SSRF → critical.
- Outdated dependencies with known CVEs → major.
- Logging of sensitive information (passwords, tokens, PII) → major.

## Bug risk
- Race conditions in async code.
- Unhandled null/undefined where the type allows it.
- Off-by-one errors in loops and indexes.
- Unreleased resources (file handles, connections, subscriptions).
- Silenced errors with empty `catch {}` blocks without justification.

## Performance
- Nested loops over large collections without necessity.
- N+1 queries in code that touches a DB.
- Blocking synchronous operations on critical paths.
- Unnecessary recalculations that could be memoized.

## Maintainability
- Functions longer than ~50 lines or with too many parameters (5+).
- Magic numbers/strings without a named constant.
- Obvious duplication (DRY) — but only when the abstraction is clear.
- Confusing or inconsistent naming compared to the rest of the file.
- Lying comments (outdated relative to the actual code).

## Testing
- New logic without tests when the repo already has a test infrastructure — but ONLY after verifying the sibling/full-file test context does not already cover the case.
- Tests that depend on execution order.
- Tests that mock what they are actually testing.
- Vague assertions (toBeTruthy instead of toBe(specificValue)).

## Architecture
- Layer boundary violations (when the project has defined layers).
- Business logic placed in controllers/UI.
- Unnecessary mutable global state added.

## What is NOT a finding
- Code style that the project's formatter already handles.
- Personal preferences without a technical reason.
- "This could be done differently" without a concrete problem.
- Asking for docs, dartdoc, comments, or placeholders that already exist in the full file or sibling context.
- Scope creep: features/improvements not required by the PR description, AC, or ADRs (e.g. progressive-loading skeletons, CloudFront, live network checks in CI).
- Flagging intentional design that project ADRs/CLAUDE.md/docs explicitly authorize (e.g. public-read brand assets for MVP).
- Demanding non-hermetic CI (live HTTP/S3/network) when hermetic unit tests exist or a script is documented as manual ops.
- Forward-looking ops reminders (future staging origins, envs that do not exist yet) — those are notes, not findings.
