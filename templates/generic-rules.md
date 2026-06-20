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
- New logic without tests when the repo already has a test infrastructure.
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
