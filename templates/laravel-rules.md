# Code review rules for Laravel / PHP

The generic rules apply plus the following Laravel-specific ones.

## Eloquent and queries
- N+1 queries (loops accessing relations without `with()`) → major.
- Mass assignment without `$fillable`/`$guarded` defined, or with `$guarded = []` → major.
- Queries with string interpolation (`whereRaw` with user input) → critical.
- `Model::all()` on large tables → major.
- Missing eager loading in paginated responses → minor.

## Requests and validation
- Controllers validating inline instead of using FormRequest → minor.
- FormRequests with `authorize` always returning `true` → minor.
- Endpoints accepting unvalidated input → major.
- Mass assignment directly from the request (`Model::create($request->all())`) without validation → major.

## Security
- Blade views using `{!! $var !!}` on user input → critical (XSS).
- Routes missing `auth` middleware when they should have it → major.
- CSRF disabled on routes that mutate state → major.
- Uploaded file storage without validating type and size → major.
- `env()` used outside config files → minor (does not work after `cache:config`).

## Services and architecture
- Business logic in controllers → minor (extract to services/actions).
- Multiple queries in a single method without a transaction → bug-risk if they are interdependent.
- Using Facades in code that should be injectable → nitpick.

## Jobs and queues
- Jobs without `tries`/`backoff` when making external API calls → minor.
- Jobs mutating models without a lock when race conditions are possible → bug-risk.
- Missing `ShouldBeUnique` where applicable → minor.
