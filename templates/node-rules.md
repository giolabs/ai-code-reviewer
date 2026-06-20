# Code review rules for Node.js

The generic rules apply plus the following Node.js-specific ones.

## Async / event loop
- Sync operations (`fs.readFileSync`, heavy `crypto`) in server request handlers → major.
- `Promise` without an error handler (`.catch` or try/await) → bug-risk.
- Unhandled rejections → major.
- Loops over arrays with `await` inside that could be parallelized with `Promise.all` → minor.

## Streams and backpressure
- Streams without an `error` event handler → bug-risk.
- Pipes without `pipeline()` when chaining multiple streams → minor.
- Reading large files entirely into memory instead of streaming → major if the size can be large.

## HTTP
- Missing timeouts on HTTP clients → major.
- No payload limit on endpoints (body parser without `limit`) → major.
- Sensitive headers logged → major.
- Responses leaking internal details (stack traces) to clients in production → major.

## File system / paths
- `path.join` with user-supplied segments without validation → critical (path traversal).
- Files opened without being closed (no `try/finally` or `using`) → bug-risk.
- Files created with overly permissive permissions (`0777`) → major.

## Dependencies
- Dynamic `require`/`import` with user-provided strings → critical.
- Use of deprecated packages → minor.
- Multiple libraries doing the same thing (e.g. axios + fetch + node-fetch) → nitpick.

## Process / OS
- `process.exit()` in library code → major.
- `process.env` accessed directly without a centralized config module → minor.
- Operations that assume a specific OS (paths with `/`, path separators) → minor.
