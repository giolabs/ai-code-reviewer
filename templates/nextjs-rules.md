# Code review rules for Next.js

The React rules apply plus the following Next.js-specific ones.

## App Router (Next 13+)
- Components with `'use client'` that could be server components → minor.
- Hooks (`useState`, `useEffect`) in files without `'use client'` → critical (won't compile).
- Server components importing code that only runs on the client → bug-risk.
- Access to `window`/`document`/browser APIs without a client guard in shared code → critical.

## Data fetching
- `fetch` with incorrect caching (default is `cache: 'force-cache'` in server components) → major if data changes.
- `useEffect` for initial fetch when a server component is available → major (use direct fetch).
- Missing `revalidate` or appropriate `cache` option for the nature of the data → minor.
- API calls with sensitive data from the client when they should be server-side → major.

## Routing
- Links using `<a href>` instead of `<Link>` for internal navigation → minor.
- `router.push()` with hardcoded paths that should be constants → nitpick.
- Missing `loading.tsx` or `error.tsx` on routes that perform data fetching → minor.

## Performance
- Images not using `next/image` when they could benefit → minor.
- Fonts not using `next/font` (causes CLS) → minor.
- Missing `next/dynamic` for large components that are only used conditionally → minor.

## Environment variables
- Sensitive variables exposed with the `NEXT_PUBLIC_` prefix → critical.
- Accessing `process.env` without checking that the variable exists → minor.
- Server-side variables accessed from the client → critical.

## API Routes / Route Handlers
- Endpoints without HTTP method validation → major.
- Missing error handling that returns internal details in the response → major.
- Endpoints without auth when handling private data → critical.
