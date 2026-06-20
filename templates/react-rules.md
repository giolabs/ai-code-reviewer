# Code review rules for React

These apply in addition to the generic rules.

## Hooks
- Broken hook rules (hooks inside conditionals/loops/callbacks) → critical.
- `useEffect` with incorrect dependency array (missing deps, extra deps, empty array when not appropriate) → major.
- `useEffect` missing cleanup for subscriptions, timers, listeners → bug-risk.
- Derived state stored in `useState` when it should be computed during render → minor.
- `useMemo`/`useCallback` applied without reason (they are not free optimizations) → nitpick.

## Renders and performance
- Inline functions passed as props causing unnecessary re-renders in large trees → minor.
- Lists rendered without a stable `key` (using index when order can change) → bug-risk.
- Components mutating props or state outside a setter → critical.
- Re-fetches on every render due to unstable dependencies → major.

## State
- Global state added for something that should be local → minor.
- `useState` with large objects fully replaced on every update → minor.
- State duplicated across multiple components instead of lifting it up → minor.

## Forms and events
- Forms without validation or with inconsistent validation between client and server → major.
- Missing `preventDefault()` where default browser behavior should be prevented → bug-risk.
- Uncontrolled inputs arbitrarily mixed with controlled ones → minor.

## Accessibility
- Buttons implemented as `<div onClick>` instead of `<button>` → minor.
- Images missing `alt` → minor.
- Inputs without an associated `<label>` → minor.
- Focus not managed in modals/dialogs → minor.

## TypeScript / PropTypes
- Props typed as `any` or `unknown` without justification → minor.
- Components receiving children without correct typing → nitpick.

## Security
- Raw HTML injection via `dangerouslySetInnerHTML` with unsanitized content → critical (XSS risk).
- `href` set directly from user input without validation (XSS via javascript: URLs) → major.
- API keys or secrets bundled in the client → critical.
