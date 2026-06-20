# Code review rules for NestJS

These apply in addition to the generic rules.

## Architecture and modules
- Services accessing another module without importing it in `imports` → bug-risk.
- Business logic in controllers → major (must be in services/use-cases).
- Services with circular dependencies → major. Resolving them with `forwardRef` is allowed only with a clear justification.
- Using `@Inject()` with magic strings instead of a constant → minor.

## DTOs and validation
- Endpoints receiving a body without a DTO with `class-validator` decorators → major.
- DTOs missing `@IsOptional()` where applicable, or with loose validations (`@IsString()` only when the field clearly requires more) → minor.
- Reusing entities as input DTOs → major (exposes internal fields).
- Missing `ValidationPipe` globally or per endpoint → major for public endpoints.

## Persistence
- Raw queries with string interpolation (SQL concatenation) → critical.
- Using `findOne({ where })` that can return null without handling it → minor or major depending on the path.
- Repositories accessed directly from controllers → major (must go through a service).
- Omitted transactions on operations that mutate multiple entities → major.
- N+1 when calling `findAll()` and then accessing lazy relations in a loop → major.

## Async / observables
- Using `Promise.all` with an array of promises that can fail partially without error handling → minor.
- Subscriptions to Observables without unsubscribe (where applicable in guards/interceptors) → bug-risk.
- `async` without `await` (function marked async but returns synchronously) → minor.

## NestJS security
- Endpoints missing `@UseGuards()` when the module exposes sensitive data → major.
- Roles/permissions hardcoded as strings without an enum → minor.
- CORS with `origin: '*'` in production → major.
- Missing rate limiting on sensitive public endpoints (login, signup, password reset) → major.

## Testing
- New services without unit tests → minor.
- New E2E tests for endpoints missing happy path + at least one error case → minor.
- Repository mocks that do not respect the real interface → bug-risk.

## Logs and observability
- `console.log` in production code → minor (use Nest's `Logger`).
- Logging sensitive information (passwords, tokens, full request body with PII) → major.
- Errors swallowed without logging or rethrowing → major.
