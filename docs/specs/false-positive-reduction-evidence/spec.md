# False-Positive Reduction from Production Evidence (PR #76)

> **Status:** READY FOR IMPLEMENTATION — corpus derived from flowstore PR #76 FP report (2026-07-17).

## 1. Goal

Raise review precision so the AI reviewer posts **verifiable defects present in the diff**, not suggestions that are already implemented, out of scope (AC/ADR), intentional documented design, non-hermetic CI asks, or forward-looking ops reminders. Use five real false-positive patterns from flowstore PR #76 as the acceptance corpus (synthetic fixtures — no dependency on that repo in CI).

---

## 2. Scope

### Included in this phase

- **Actionable finding gate** in `PromptBuilder.buildSystemPrompt` + expanded "What is NOT a finding" in `templates/generic-rules.md`.
- Pass **`projectDigest` into `FindingVerifier`** and harden refute criteria (defect must be verifiable now; refute ADR contradictions, already-present asks, scope creep, future ops).
- **Diff-relevant ranking** of docs/ADRs before `maxChars` truncation in `ProjectKnowledgeDigest`.
- **Sibling context loader**: budgeted extracts of sibling test files and infra READMEs next to changed paths, injected into the user prompt.
- Vitest regression fixtures for FP-01..04, OPS-01, plus one true-bug survivor.
- `CHANGELOG.md` entry.

### Out of scope

- Global test-coverage indexer / whole-repo AST.
- Wiring `OfficialDocsProvider` / Context7.
- Enabling `learnings.enabled` by default.
- Changing `@botai dismiss` / `@botai resolved` contracts.
- Multi-vote juries or disabling fail-open on verifier network errors.
- Indexing all of `infra/` into the digest by default.

---

## 3. Technologies & conventions

### Stack

- TypeScript ESM (`"type": "module"`), Node `>=18`, Vitest, `tsc` → `dist/`.
- No new npm dependencies.

### Relevant versions (from `package.json`)

| Field | Value |
|---|---|
| `version` | `0.1.0-beta.16` |
| `typescript` | `^5.6.0` |
| `vitest` | `^3.2.6` |

### Existing patterns to follow

- `src/finding-verifier.ts` — adversarial second pass; fail-open.
- `src/project-knowledge.ts` — digest assembly + char budget.
- `src/prompts.ts` — `PromptBuilder` class methods with explicit interfaces.
- `__test__/finding-verifier.test.ts` — mock `LLMAdapter.review`; AAA blocks.
- CLAUDE.md: one class per file; params as typed object; no `any`/`unknown`; English code.

---

## 4. Prerequisites

- [x] `FindingVerifier` exists and is called from `callLLM` when `selfCritique.enabled`.
- [x] `ProjectKnowledgeDigest.build()` injects digest into first-pass system prompt.
- [x] `ChangedFile.content` can hold full-file context (Axis 5).
- [x] `templates/generic-rules.md` has "What is NOT a finding".
- [x] Vitest configured with `include: ['__test__/**/*.test.ts']`.

---

## 5. Architecture

**Pattern:** prompt-first filter + adversarial verifier enrichment + minimal grounding.

```
Changed files + PR meta
        │
        ▼
ProjectKnowledgeDigest (ranked by diff/PR keywords)
        │
        ▼
PromptBuilder (Actionable finding gate + sibling context)
        │
        ▼
First-pass LLM → findings
        │
        ▼
FindingVerifier(diff + codeRef + projectDigest) → survivors
        │
        ▼
confidence×severity gate → post
```

### File layout (new / modified)

| Path | Action | Purpose |
|---|---|---|
| `docs/specs/false-positive-reduction-evidence/spec.md` | NUEVO | This spec |
| `src/prompts.ts` | MODIFICAR | Actionable gate; sibling section in user prompt |
| `templates/generic-rules.md` | MODIFICAR | Expand NOT a finding |
| `src/finding-verifier.ts` | MODIFICAR | Accept digest; stronger refute prompt |
| `src/reviewer.ts` | MODIFICAR | Pass digest to verifier; load sibling context |
| `src/project-knowledge.ts` | MODIFICAR | Rank docs by relevance |
| `src/sibling-context.ts` | NUEVO | Load sibling tests / infra READMEs |
| `src/types.ts` | MODIFICAR | Optional fields on build args if needed |
| `__test__/finding-verifier.test.ts` | MODIFICAR | FP corpus + true bug |
| `__test__/prompts.test.ts` | MODIFICAR | Gate present in system prompt |
| `__test__/project-knowledge.test.ts` | NUEVO | Ranking behaviour |
| `__test__/sibling-context.test.ts` | NUEVO | Sibling loader |
| `CHANGELOG.md` | MODIFICAR | Feature entry |

---

## 6. Files to create or modify

### Detalle por archivo

**`src/prompts.ts`** — Add `buildActionableFindingGate()`; inject after project authority / before checklist. Harden `buildDetectionChecklist` technical-debt bullet. Extend `buildUserPrompt` / incremental prompt to append optional `siblingContext` string with instruction to verify missing-test/docs claims against it.

**`templates/generic-rules.md`** — Append bullets matching the five anti-FP rules (already present, scope creep, intentional design, hermetic testing, future ops).

**`src/finding-verifier.ts`** — Extend `VerifyArgs` with `projectDigest?: string`. Refute system prompt must: (1) require a defect verifiable in cited code/diff now; (2) drop if contradicts project digest; (3) drop if asks for docs/tests already in context; (4) drop scope creep / future ops / non-hermetic CI asks.

**`src/project-knowledge.ts`** — Extend `BuildDigestArgs` with `changedPaths?: ReadonlyArray<string>`, `prTitle?: string`, `prBody?: string | null`. Score each candidate: path overlap with changed dirs, ADR/US tokens from title/body, filename keyword hits. Sort descending before truncation. Keep CLAUDE.md first when enabled.

**`src/sibling-context.ts`** — New class `SiblingContextLoader`. Given cwd + changed paths, for each path: if implementation file, look for `*.spec.ts`, `*.test.ts`, `*_test.dart` siblings (same basename); if under `infra/`, include nearest `README.md` in that directory tree (cap depth). Budget: default 12_000 chars total, truncate per file. Return markdown sections.

**`src/reviewer.ts`** — After loading file content, call sibling loader; pass into `buildUserPrompt`. Pass `projectDigest` into `verifier.verify`. When building digest in `resolveConfig`, ranking needs changed paths — for PR path, rebuild or pass paths at `callLLM` time: prefer building digest once in `resolveConfig` without paths today, **and** optionally rebuild/rank inside `callLLM` when files are known. Locked decision: **re-rank inside `callLLM`** by instantiating `ProjectKnowledgeDigest` with file paths + PR title/body when `projectContext` is configured (reuse cwd from resolveConfig). Simpler alternative locked: extend `resolveConfig` return with builder; `callLLM` calls `digestBuilder.build({ config, changedPaths, prTitle, prBody })`. Implement via passing `cwd` + `config.projectContext` into `callLLM` and rebuilding ranked digest there (overwrite `projectDigest`). Local `review-file`/`review-diff` also get ranking when paths known.

---

## 7. API Contract

Sin API surface — no aplica.

---

## 8. Success criteria

### Tests required

| File | Scenarios |
|---|---|
| `__test__/prompts.test.ts` | System prompt contains Actionable finding gate phrases (already present, scope creep, hermetic, future ops) |
| `__test__/finding-verifier.test.ts` | FP-03: security finding on public-read with ADR digest → dropped; FP-02: missing empty-key test when codeRef has `expect(mapper.resolve(''))` → dropped; OPS-01: future staging CORS → dropped; true null-deref bug → survives; fail-open unchanged |
| `__test__/project-knowledge.test.ts` | With many docs, ADR matching PR title ranks into digest before unrelated long docs |
| `__test__/sibling-context.test.ts` | Finds `foo.spec.ts` next to `foo.ts`; finds `infra/x/README.md` when `infra/x/policy.json` changed |

### Verification commands

```bash
npm test
npm run build
```

---

## 9. UX criteria

Not applicable — CLI/GitHub bot, no interactive UI forms. User-facing change: fewer inline false positives; console still logs dropped count from self-critique.

### Loading / Formularios / Passwords / Errores / Navegacion / Accesibilidad

No aplica — no UI surface.

---

## 10. Decisions made (locked)

1. **Prompt + verifier + minimal grounding** in one shippable change (not prompt-only).
2. **Verifier receives `projectDigest`** — soft authority becomes enforceable at refute time.
3. **Sibling context is budgeted markdown**, not a full test indexer.
4. **Infra README only when a changed path is under that infra directory** — no global infra crawl.
5. **Fail-open on verifier errors** preserved.
6. **Corpus is synthetic fixtures** — do not clone flowstore in CI.
7. **Technical debt checklist** only for concrete defects/risks in the diff — not "consider X".
8. **Rebuild ranked digest in `callLLM`** when `projectContext` + cwd available so PR title/paths influence ranking.

---

## 11. Edge cases

| Case | Behaviour |
|---|---|
| Empty digest | Verifier works as today (diff + codeRef only) |
| No sibling files | Omit sibling section from user prompt |
| Digest longer than maxChars | Rank then truncate; CLAUDE.md prefer-first |
| Verifier returns invalid JSON | Fail-open: keep first-pass findings |
| Incremental review | Same gate in incremental system prompt; sibling context for new files; verifier only if selfCritique already wired on incremental path — **locked: wire digest into verifier wherever `FindingVerifier.verify` is called**; incremental currently skips verifier — **do not add verifier to incremental in this phase** (out of trickle scope) |
| Invalid / missing paths | Sibling loader skips silently |

### API errors / Sin conexion / Timeout

Verifier network failure → fail-open (existing). No HTTP API surface.

### Datos invalidos / Respuesta vacia / Doble submit

Malformed survivors array → fail-open. Empty findings → skip verifier.

---

## 12. Required UI states

No aplica — no UI.

---

## 13. Validations

### Client

| Campo | Regla | Mensaje |
|---|---|---|
| `confidenceThreshold` | unchanged 0–1 | existing config |
| Sibling budget | hard cap in code | truncate |

### Server

No aplica.

---

## 14. Security & permissions

- Digest and sibling files are local workspace / checked-out repo content only — no new secrets.
- Do not log full digest contents at info level (keep existing dim logs).
- Public-read ADR patterns must not be re-flagged as vulnerabilities when digest documents them.

---

## 15. Observability & logging

- Keep existing: `Auto-verificación: N finding(s) descartados...`
- Optional dim log when sibling context chars > 0: `Contexto hermano: N archivo(s)`.
- Never log API keys.

---

## 16. i18n / user-facing copy

- System/refute prompts: English (model instructions), matching existing `FindingVerifier` / most of `PromptBuilder`.
- CLI console strings: Spanish rioplatense where new (consistent with `reviewer.ts`).
- No translation keys.

| Key | Text |
|---|---|
| N/A | Console: `Contexto hermano: ${n} archivo(s).` |

---

## 17. Performance

- Sibling loader: sync fs, ≤15 sibling files, ≤12_000 chars total.
- Digest ranking: O(n docs) scoring, n ≤ 400 walk cap (existing).
- One extra LLM call unchanged (self-critique already exists).

---

## 18. Restrictions

- Do not enable learnings by default.
- Do not add dependencies.
- Do not index entire `infra/` or all tests.
- Do not change fingerprint / dismiss semantics.
- Do not remove fail-open.
- Do not invent OpenSpec proposal in this phase unless requested.

---

## 19. Deliverables

- [ ] Spec file (this document)
- [ ] Prompt gate + generic-rules update
- [ ] FindingVerifier + reviewer wiring
- [ ] Ranked `ProjectKnowledgeDigest`
- [ ] `SiblingContextLoader` + user-prompt injection
- [ ] Regression tests (5 FP patterns + 1 true bug)
- [ ] CHANGELOG entry

---

## 20. Final agent checklist

- [ ] Spec read end-to-end
- [ ] Only listed files touched
- [ ] Classes / typed option objects per CLAUDE.md
- [ ] AAA tests, one class per test file where new
- [ ] `npm test` and `npm run build` pass
- [ ] No `any` / `unknown`
- [ ] No unjustified TODOs

---

## Appendix A — Acceptance corpus (synthetic)

### FP-01 — Docs / placeholder already present or out of scope

Finding asking for progressive-loading placeholder / undocumented props when full file has dartdoc and ADR says monogram fallback → must not survive / must not be emitted.

### FP-02 — Missing test already asserted

Finding "add empty logoKey test" when same file contains `expect(mapper.resolve('')).toBeUndefined()` → drop.

### FP-03 — Intentional public-read

Finding "Principal * is insecure" when digest includes ADR stating public-read MVP without CloudFront → drop.

### FP-04 — Non-hermetic CI for documented manual script

Finding "add live S3 GET to CI" when README says manual verify + hermetic Jest exists → drop.

### OPS-01 — Future staging CORS

Finding "add staging origins" when no staging env exists yet → drop (ops note only, not finding).

### TRUE — Null deref without guard

Finding citing `user.name.length` where `user` may be null in the diff → must survive.
