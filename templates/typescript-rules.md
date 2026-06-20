# Code review rules for TypeScript

The generic rules apply plus the following TypeScript-specific ones.

## Types
- Use of `any` without a justifying comment → minor.
- Use of `as` (type assertion) when a type guard could be used instead → minor.
- `as any` or `as unknown as X` → major (bypasses the type system).
- `Function`/`Object`/`{}` types instead of specific types → minor.
- Missing `readonly` on arrays/props that are not mutated → nitpick.
- Implicit `any` returns due to broken inference → minor.

## Null safety
- Property access with `!` (non-null assertion) without an obvious guarantee → bug-risk.
- Optional chaining (`?.`) used while assuming non-null a few lines later → bug-risk.
- Missing handling of `undefined`/`null` on values the type allows → minor or major depending on path.

## Enums and unions
- Numeric enums when a string literal union would be safer → nitpick.
- Switches over unions without a `default` case performing a `never` check → minor.
- Discriminated unions without an explicit string discriminator → minor.

## Async
- Unawaited promises (floating promises) → bug-risk.
- Async functions that do not need to be async → nitpick.
- `try/catch` that captures the error but loses the stack on re-throw → minor.

## Modules
- Circular imports → major.
- Relative imports with deep paths (`../../../`) when path aliases are available → nitpick.
- Unnecessary re-exports in barrel files that hinder tree-shaking → minor.

## Compiler configuration
- Code that only compiles with `strict: false` → major (should compile in strict mode).
- Use of `// @ts-ignore`/`// @ts-expect-error` without a comment explaining why → minor.
