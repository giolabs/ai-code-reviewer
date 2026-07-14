# Reviewer Maturity — 8 Axes

> **Status:** PENDING PROPOSAL/CHANGE — no OpenSpec change has been generated yet. Run `/openspec-propose` (or `/opsx:propose`) using this spec as input.

## 1. Goal

Mature the AI reviewer from "works but noisy" to "trusted senior reviewer" by attacking eight concrete weaknesses observed in production: repeated false positives / hallucinations, CI runner-minute waste, weak bug certainty, comment "trickle" across pushes, missing project-context grounding, and lack of official-docs grounding. Each axis is independently valuable and independently shippable; together they raise precision, cut cost, and align the reviewer's expectations with the developer's.

The eight axes:

1. **CI cost** — stop wasting runner minutes on stacked/no-op pushes.
2. **False-positive suppression** — semantic fingerprinting + permanent dismissal memory.
3. **No trickle** — exhaustive first run, verify-only incremental runs.
4. **Self-critique** — a verification pass that refutes weak findings before posting.
5. **Bug certainty** — full-file context + explicit detection checklist (regression, silent failures, tech debt, domain violations, architecture patterns) + mandatory code suggestions.
6. **Per-comment actions** — `@botai` command surface: `resolved` / `dismiss` / `explain` / `approved`, always visible.
7. **Project grounding** — read `CLAUDE.md` + `docs/` (incl. ADRs) as authority over generic rules, cached as a digest.
8. **Stack docs grounding** — versioned rule packs + local `node_modules` READMEs by default, Context7 (HTTP, opt-in) as a premium layer.

---

## 2. Context Precedence (authority order)

Every prompt must apply project rules in this order, highest authority first. A finding that contradicts a higher-authority source is invalid; a finding that flags a violation of one is high priority.

1. `.ai-review.yml` / `code-review-rules.md` (explicit review config).
2. `CLAUDE.md` (root + nested) — team conventions/standards.
3. `docs/` (`docs/adr/*`, `architecture*`, `*-rules*`, `conventions*`, `domain*`) — architecture & decisions.
4. `templates/<stack>-rules.md` — generic built-in baseline.
5. Official stack docs (versioned rule packs / node_modules READMEs / Context7).

---

## 3. Axis 1 — CI Cost Reduction

**Problem:** `examples/.github/workflows/ai-review.yml` triggers a full runner on every `synchronize`. Rapid pushes stack N full runs; doc-only pushes still burn minutes.

**Change:**
- Add a `concurrency` group keyed by PR number with `cancel-in-progress: true`.
- Add `paths-ignore` for docs/lockfiles/assets (`**/*.md`, `**/*.lock`, `package-lock.json`, images) with a commented note that it is tunable.
- Keep `if: draft == false`.
- Update `examples/.github/workflows/ai-review.yml`, `handle-feedback.yml` where relevant, and document in `docs/pages`.

**Acceptance:** Given 4 pushes within the concurrency window, only 1 review job runs to completion; a docs-only push runs 0 review jobs.

**Out of scope:** Moving the LLM call off the runner (webhook/service) — documented as a future phase, not built here.

---

## 4. Axis 2 — Semantic Fingerprint + Dismissal Memory

**Problem:** `buildFindingMetadata()` (`src/github.ts`) fingerprints findings as `sha1(file:line:title)`. When a line shifts or the model rewords the title, the hash changes and the finding re-posts as new → repeated false positives.

**Change:**
- Replace the fingerprint input with a **position-independent** basis: `sha1(file + category + normalize(codeSnippet))`, where `normalize` strips whitespace/line-number noise from the cited code the finding refers to. Add the cited snippet to `ReviewFinding` (new optional `codeRef?: string` in `src/types.ts`) so the model returns the exact code it is judging.
- Persist a **suppression list** of dismissed fingerprints in the hidden context comment (reuse `findContextComment` / `createContextComment` in `src/github.ts` and `ProjectContext` in `src/project-context.ts`). Add `suppressedFingerprints: string[]` to the persisted context payload.
- When `@botai dismiss` (see Axis 6) fires, append that finding's fingerprint to the suppression list.
- Before posting any finding (full or incremental), filter out those whose fingerprint is in the suppression list.

**Acceptance:** A finding dismissed once never reappears on any later push, even if its line moves or its title is reworded.

**Out of scope:** Cross-PR suppression memory.

---

## 5. Axis 3 — Exhaustive First Run, No Trickle

**Problem:** (a) `maxInlineComments: 20` cap sends overflow findings to the summary, perceived as "appearing later"; (b) the incremental prompt still surfaces new critical/major findings on new lines, perceived as trickle.

**Change:**
- **First run = exhaustive:** the `opened` / full-review path posts *all* findings from the first review at once — inline where they map, the rest grouped in the summary from minute zero (already partially done via `orphans`; guarantee no silent drop, and log the count posted vs capped).
- Make the inline cap configurable and decouple it from completeness: capped findings still appear in the summary, never dropped.
- **Incremental = verify-only:** harden `buildIncrementalSystemPrompt` so incremental runs ONLY (a) resolve fixed prior findings and (b) report critical/major issues *introduced by the new push itself* — never new minor/nitpick/info observations, and never re-discover pre-existing issues from earlier pushes.
- Add a contract line to the summary: "This is the complete review. Later pushes only verify resolutions and regressions; they do not add new style observations."

**Acceptance:** Given a PR with 30 first-run findings, all 30 are visible after the first run (inline + summary). A subsequent push that only adds clean code posts 0 new findings; a push that introduces a new critical bug posts exactly that one.

---

## 6. Axis 4 — Self-Critique Verification Pass

**Problem:** Some findings are plausible but wrong (hallucinated). No verification stage exists.

**Change:**
- Add a `confidence: number` (0–1) field to `ReviewFinding` (`src/types.ts`) and to `REVIEW_SCHEMA` (`src/llm/openai.ts` and each provider's schema).
- Add a new `src/finding-verifier.ts` class (`FindingVerifier`) that takes the first-pass findings + the diff and issues a second, cheap LLM call whose instruction is adversarial: *"For each finding, using only the cited code, try to refute it. Return which findings survive."* Discard findings that do not survive.
- Gate low-confidence, low-severity findings: `confidence < threshold` AND severity ≤ `minor` → not posted inline (moved to summary "optional observations" or dropped per config).
- Add config `selfCritique: { enabled: boolean; confidenceThreshold: number }` (default enabled, threshold 0.6).

**Acceptance:** A first-pass finding whose cited code does not actually contain the described defect is removed before posting.

**Out of scope:** Multi-vote juries (single refutation pass only in this phase).

---

## 7. Axis 5 — Bug Certainty: Context + Detection Checklist + Suggestions

**Problem:** Prompt is generic; only the diff is sent (not full file), so silent failures and domain violations outside the changed lines are missed. `suggestion` is optional.

**Change:**
- **Full-file context (budgeted):** load `ChangedFile.content` (already in the type, unused) for small/medium changed files and include it in the user prompt alongside the diff, under a char budget; fall back to diff-only when over budget. Wire via `GitHubClient.getFileContent`.
- **Detection checklist in the system prompt**, one explicit block per axis the user asked for:
  - *Regression:* per importer in the dependency index, reason about changed signatures, return contracts, side effects.
  - *Silent failures:* empty `catch`, swallowed errors, un-awaited promises, defaults hiding failures, `?.` masking unexpected null.
  - *Technical debt:* dedicated `info`/`minor` findings for duplication, coupling, temporary workarounds.
  - *Domain violations:* contrast against project rules + stack invariants (business logic in the wrong layer, etc.).
  - *Architecture patterns:* layer-boundary violations (controller→service→repository), broken dependency inversion, inconsistency with the surrounding module.
- **Mandatory suggestion for severity ≥ major:** `REVIEW_SCHEMA` requires a `suggestion` code block for `critical`/`major` findings, formatted as a GitHub ` ```suggestion ` block when it applies to a single contiguous line range.

**Acceptance:** A swallowed error 40 lines above the diff is flagged; every major/critical finding carries an applicable code suggestion.

---

## 8. Axis 6 — Per-Comment Actions (`@botai` surface)

**Problem:** Command system exists (`approved`/`review`/`resolved` in `src/feedback-handler.ts`) but is not discoverable and lacks a false-positive path.

**Change:**
- Extend `BotCommand` (`src/types.ts`) and `parseBotCommand` regex to include `dismiss` and `explain`.
  - `dismiss` → mark finding `FindingStatus.Dismissed`, resolve the thread, and add its fingerprint to the Axis-2 suppression list.
  - `explain` → on-demand second LLM call returning a fuller rationale / a concrete fix, posted as a reply.
- Render an **actions footer** on every inline comment body (`formatInlineCommentBody` in `src/github.ts`):
  > `@botai resolved` to close · `@botai dismiss` (false positive) · `@botai explain` for detail
- Document `@botai approved` (manual approve) in the summary footer. Preserve the never-auto-approve-without-human rule (`mapRecommendationToEvent`).

**Acceptance:** Each inline comment shows the four actions; `@botai dismiss` closes the thread and suppresses that finding permanently.

---

## 9. Axis 5b — Resolution Check Without Strictness

**Problem:** `buildFeedbackEvaluationPrompt` can be too strict about accepting fixes.

**Change:**
- Bias the evaluation prompt toward `resolved`: *"If the change reasonably addresses the concern — even if it is not the exact fix suggested — mark resolved. Only maintain when the original problem is clearly still present. When in doubt, resolve and explain briefly."*
- Evaluate against the *current file state* vs the *problem*, not vs the suggested fix.
- **Auto-resolve in incremental:** when a push touches a prior finding's line and the problem no longer appears, resolve the thread automatically with a short reply, without waiting for `@botai`.

**Acceptance:** A fix that solves the problem differently than suggested is accepted as resolved.

---

## 10. Axis 7 — Project Grounding (CLAUDE.md + docs/)

**Problem:** `RulesLoader` reads only `code-review-rules.md` + the stack template. It ignores `CLAUDE.md` and `docs/`.

**Change:**
- New `src/project-knowledge.ts` class (`ProjectKnowledgeDigest`) that:
  - Always reads root + nested `CLAUDE.md`.
  - Selects relevant `docs/` files by name globs (`architecture*`, `adr/*`, `*-rules*`, `conventions*`, `domain*`) and by relevance to the diff's files.
  - Produces a bounded **digest** (char budget from config).
- **Cache the digest** in the hidden context comment; invalidate by hash of `CLAUDE.md` + docs index (mirror the existing `ProjectContext` version-invalidation pattern in `src/project-context.ts`).
- Inject the digest into the system prompt under the precedence rules of §2.
- New config `projectContext: { claudeMd: boolean; docsGlobs: string[]; maxChars: number }` (defaults: true, sensible globs, budget).

**Acceptance:** A finding that contradicts a documented project decision is not produced; a violation of a documented convention is flagged as high priority.

---

## 11. Axis 8 — Official Stack Docs Grounding

**Problem:** No version-specific official docs; the model relies on its own (possibly stale) knowledge of framework APIs.

**Change (layered):**
- **8A — Versioned rule packs (default, deterministic):** extend `src/tech-detect.ts` to read the stack **version** from `package.json` / `pubspec.yaml`; resolve version-keyed rule snippets. Also opportunistically read the installed package README from `node_modules/<lib>/README*` (exact to the installed version, zero network).
- **8B — Context7 via HTTP (opt-in, gated, fail-open):** new `src/official-docs.ts` (`OfficialDocsProvider`) that, only for libraries/APIs appearing in the diff (relevance-gating), fetches version-specific docs from Context7's HTTP API using a repo-secret API key; cache keyed by `lib@version` with TTL in the context comment; **fail-open** (any error/rate-limit → continue without docs, never fail CI). Gated by config `officialDocs: { provider: 'context7' | 'none'; enabled: boolean }` (default `none`/disabled).

**Acceptance:** Version-specific API misuse is caught by 8A offline; when 8B is enabled, doc snippets for touched libraries are injected and a provider outage does not fail the review.

**Out of scope:** Building the Context7 caching/TTL beyond a minimal opt-in skeleton if time-boxed — 8B may ship as a documented, feature-flagged skeleton with 8A fully functional.

---

## 12. Scope

### Included

- All source changes across `src/*.ts` and `src/llm/*.ts` listed per axis above.
- New modules: `src/finding-verifier.ts`, `src/project-knowledge.ts`, `src/official-docs.ts`.
- Config schema additions in `src/config.ts` + `src/types.ts` + `EXAMPLE_CONFIG` in `src/cli.ts` + `init` template.
- Workflow YAML changes in `examples/.github/workflows/`.
- Vitest tests in `__test__/` mirroring `src/`, per the CLAUDE.md testing rules (AAA, one class per file, `<100` lines).
- Docs pages update under `docs/pages`.

### Out of scope

- Moving the LLM call off the CI runner (Axis 1 future phase).
- Cross-PR learning / suppression memory.
- Multi-vote verification juries (Axis 4 future phase).
- Full Context7 productionization beyond the opt-in skeleton (Axis 8B).

---

## 13. Testing

Per CLAUDE.md: Vitest, `__test__/` at root mirroring `src/`, mandatory AAA blocks, one class per file, minimal mocks only at real boundaries (LLM/network/disk). Priority units to cover:

- Semantic fingerprint stability under line-shift / title-reword (Axis 2).
- Suppression-list filtering (Axis 2/6).
- Incremental verify-only findings filtering (Axis 3).
- `FindingVerifier` refutation + confidence gating (Axis 4).
- `parseBotCommand` for `dismiss` / `explain` (Axis 6).
- `ProjectKnowledgeDigest` selection + hash invalidation (Axis 7).
- Version extraction in `TechDetector` (Axis 8A).

---

## 14. TypeScript Constraints (mandatory)

All code follows the CLAUDE.md standards without exception: no `any`/`unknown`; all logic in classes; single typed-object parameters; explicit method return types; `readonly` for immutable data; `enum` for closed sets; `interface` for contracts / `type` for unions; ESM `.js` import extensions; one class per file; constructor dependency injection. User-facing CLI strings stay in Spanish (rioplatense).
