# Custom code review rules

This file is appended to the AI reviewer's system prompt. Reference it from `.ai-review.yml`:

```yaml
rules: ./code-review-rules.md
```

Rules here take precedence over built-in templates. Write them as imperative checks the reviewer must apply.

---

## Architecture

- Never import from a domain layer into an infrastructure layer. Any `import` of a TypeScript class from `src/infrastructure/` or `src/database/` inside `src/domain/` is a `major` finding.
- Business logic must live in services or use-cases, never in controllers. A controller method containing conditionals or data transformations beyond DTO mapping is a `major` finding.
- Never access a repository directly from a controller. All repository calls must go through a service. Flag as `major`.
- Every NestJS module must declare its own providers. Cross-module access via `@Inject()` with a magic string instead of an exported constant → `minor`.

```
❌ Bad — business logic in controller
@Post()
create(@Body() dto: CreateOrderDto) {
  if (dto.total > 1000) dto.priority = 'high'; // logic here
  return this.ordersService.create(dto);
}

✅ Good — logic in service
@Post()
create(@Body() dto: CreateOrderDto) {
  return this.ordersService.create(dto);
}
```

## TypeScript conventions

- Never use `any` in domain or application code. Use explicit interfaces or union types. `any` in domain code → `major`; `any` in test files → allowed.
- Never use `as X` type assertions to bypass the type system. `as any` or `as unknown as X` → `major`. Use type guards or model the type correctly.
- All class properties that are not mutated after construction must be `readonly`. Missing `readonly` on injected dependencies → `minor`.
- Every public class method must declare an explicit return type. Missing return type on a public method → `minor`.
- `// @ts-ignore` or `// @ts-expect-error` without an explanatory comment → `minor`. With a comment explaining the workaround → allowed.

```
❌ Bad — implicit any, no return type
async getUser(id) {
  return this.repo.findOne(id) as any;
}

✅ Good — typed, explicit
async getUser(id: string): Promise<User | null> {
  return this.repo.findOne({ where: { id } });
}
```

## Security

- Endpoints that expose user data must be protected with `@UseGuards(JwtAuthGuard)`. A missing guard on a non-public endpoint → `major`.
- Environment variables must be accessed via `ConfigService`, never via `process.env` directly in application code → `minor`.
- Never hardcode secrets, API keys, URLs, or business constants in source files → `critical`.
- DTOs that receive external input must use `class-validator` decorators. Missing validation on a public POST/PUT/PATCH body → `major`.
- Raw SQL string concatenation or template literals in queries → `critical`.

## Testing

- Every new service must have a unit test file covering at least the happy path and one error case → `minor` if missing.
- Test mocks must respect the real interface. A mock that adds methods not on the interface, or omits required methods, is a `bug-risk`.
- `console.log` or `console.error` in production code → `minor` (use NestJS `Logger`). In test files → allowed.
- Never swallow errors silently. A `catch` block that does nothing, or only logs without rethrowing or returning an error response → `major`.

## Accepted exceptions

The reviewer must NOT flag these patterns in this project:

- `as any` inside `__test__/` or `*.spec.ts` files — test fixtures often require it.
- `process.env` access inside `src/config/` or files named `*.config.ts` — that is the designated config boundary.
- Missing `@UseGuards()` on endpoints decorated with `@Public()` — those are explicitly public routes.
- One-off migration scripts under `scripts/` do not require unit tests.
