# English Migration

> **Status:** DRAFT

## 1. Goal

Migrate all non-user-facing content in the repository to English. This covers inline code comments, internal error strings, LLM system prompt templates, tech-stack rule templates, existing spec files, and Spanish sections in CLAUDE.md. User-facing CLI output (chalk terminal messages, Commander `--help` descriptions) and README.md remain in Spanish as they target end users who may prefer Spanish.

After this migration, any developer (or Claude Code agent) reading source files, templates, or specs will work entirely in English, in line with the `Language` rule added to CLAUDE.md.

## 2. Scope

### Included in this phase

- Translate all inline comments (`//`, block comments) in every `src/*.ts` file from Spanish to English
- Translate internal error strings and non-user-facing `throw new Error(...)` messages in `src/*.ts` from Spanish to English
- Translate the `EXAMPLE_CONFIG` template string in `src/cli.ts` (written to `.ai-review.yml` on `init`) from Spanish to English — it is developer-facing config documentation, not runtime output
- Translate the LLM system prompt template in `src/prompts.ts` from Spanish to English — it goes to the LLM model, not to the end user
- Translate all 8 files in `templates/*.md` from Spanish to English — they are LLM instructions, not user output
- Translate `docs/specs/multi-llm-github-action/spec.md` from Spanish to English
- Translate the Spanish sections of `CLAUDE.md` (TypeScript Coding Standards and Testing with Vitest sections) from Spanish to English

### Out of scope

- `README.md` — stays in Spanish (end-user documentation)
- User-facing chalk output strings in `src/output.ts` and `src/cli.ts` (`'Resumen:'`, `'Recomendación:'`, `'Sugerencia:'`, markdown report labels, Commander option/command descriptions shown in `--help`) — these stay in Spanish
- Strings embedded in GitHub PR review comment bodies (e.g., `'**Recomendación del modelo:**'` in `src/reviewer.ts`, `'### Observaciones adicionales'` and `'_(Estos findings refieren a líneas fuera del diff...)_'` in `src/github.ts`) — these are visible to GitHub users reading the PR; they stay in Spanish
- The `language` field in `.ai-review.yml` and related logic in `src/prompts.ts` that controls the language the LLM writes reviews in — this is a runtime config option, not source language
- `src/types.ts` — already entirely in English, no changes needed
- Adding new features, refactoring logic, or changing any behavior — this is a content-only migration
- Setting up a translation CI check (out of scope for this phase)

## 3. Technologies & Project Conventions

### Stack

- **Language:** TypeScript (ESM, `"type": "module"`)
- **Runtime:** Node.js >= 18
- **CLI framework:** Commander
- **Module resolution:** Bundler (`tsconfig.json`)
- **Target:** ES2022

### Relevant versions

| Dependency | Version | Source |
|---|---|---|
| typescript | ^5.6.0 | `package.json` |
| tsx | devDependency | `package.json` |

### Existing patterns to follow

- ESM imports use `.js` extension even for `.ts` source files — do not change any import paths
- Comments use `//` single-line style; no JSDoc blocks — do not add JSDoc where none existed
- Template files use Markdown with H2 headings per check category — preserve structure, translate prose only
- Spec files follow the 20-section format — preserve all headings and structure, translate prose only

## 4. Prerequisites

- [x] `CLAUDE.md` has the `Language` rule already added (confirmed — added in previous session)
- [x] All source files are readable and the project builds (`npm run build`)
- [x] No in-progress feature branches that touch the same files (confirm before starting)

## 5. Architecture

### Pattern

Content-only migration — no architectural changes. The migration proceeds file-by-file, category-by-category. No new files are created. No logic is changed. No imports are added or removed.

### Affected layers

| Layer | Affected? | Description |
|---|---|---|
| Source comments | Yes | All `//` and block comments in `src/*.ts` |
| Internal error strings | Yes | `throw new Error(...)` with Spanish messages |
| LLM system prompt | Yes | Template string in `src/prompts.ts` sent to the model |
| Tech rule templates | Yes | All 8 `templates/*.md` files |
| Spec docs | Yes | `docs/specs/multi-llm-github-action/spec.md` |
| Project guidelines | Yes | Spanish sections of `CLAUDE.md` |
| User-facing output | **No** | chalk strings, Commander descriptions, README.md |
| Business logic | **No** | Zero code behavior changes |

### Expected flow (migration order)

1. Translate `src/config.ts`, `src/tech-detect.ts` — low risk, comments only
2. Translate `src/reviewer.ts`, `src/github.ts` — comments + one internal error string
3. Translate `src/prompts.ts` — system prompt template (careful: keep `config.language` runtime logic intact)
4. Translate `src/cli.ts` — comments and `EXAMPLE_CONFIG` only; Commander descriptions stay Spanish
5. Translate all 8 `templates/*.md` — full content translation
6. Translate `docs/specs/multi-llm-github-action/spec.md` — full prose translation, preserve 20-section structure
7. Translate Spanish sections of `CLAUDE.md` — TypeScript standards and Vitest testing sections
8. Run `npm run build` — verify zero compile errors
9. Run grep checks (see section 8) — verify no Spanish remains in wrong places

## 6. Files to create or modify

| Path | Action | Risk | Purpose | Example to follow |
|---|---|---|---|---|
| `src/config.ts` | MODIFY | LOW | Translate ~27 lines of Spanish block comments to English | English comments already in `src/types.ts` |
| `src/tech-detect.ts` | MODIFY | LOW | Translate ~5 lines of Spanish inline comments to English | `src/types.ts` |
| `src/reviewer.ts` | MODIFY | LOW | Translate Spanish comments + two internal error strings: `'No se detectó contexto de PR...'` and `'Archivo no encontrado: ${absPath}'`. Do NOT translate the GitHub PR body string `'**Recomendación del modelo:**'` — it stays Spanish (user-facing). | `src/types.ts` |
| `src/github.ts` | MODIFY | LOW | Translate ~6 lines of Spanish inline comments + one internal error string (`'GITHUB_TOKEN no está definido...'`). Do NOT translate the PR body strings `'### Observaciones adicionales'` and `'_(Estos findings refieren a líneas fuera del diff...)_'` — they stay Spanish (user-facing). | `src/types.ts` |
| `src/prompts.ts` | MODIFY | **HIGH — see detail below** | Translate the Spanish system prompt template (~36 lines) to English; keep `config.language` branch logic intact | Existing English comment style in `src/types.ts` |
| `src/cli.ts` | MODIFY | **HIGH — see detail below** | Translate `EXAMPLE_CONFIG` template (~73 lines) and `//` comments to English; Commander descriptions and chalk output stay Spanish | `EXAMPLE_CONFIG` pattern in the same file |
| `src/output.ts` | MODIFY (comments only) | HIGH | No Spanish comments exist in this file (confirmed by grep). Chalk output strings and markdown report labels must stay Spanish. If any Spanish comment is found, translate it; do not touch any chalk call. | — |
| `templates/generic-rules.md` | MODIFY | LOW | Translate all review rules (~44 lines) to English | — |
| `templates/nestjs-rules.md` | MODIFY | LOW | Translate all review rules (~43 lines) to English | `templates/generic-rules.md` |
| `templates/nextjs-rules.md` | MODIFY | LOW | Translate all review rules (~35 lines) to English | `templates/generic-rules.md` |
| `templates/react-rules.md` | MODIFY | LOW | Translate all review rules (~41 lines) to English | `templates/generic-rules.md` |
| `templates/typescript-rules.md` | MODIFY | LOW | Translate all review rules (~35 lines) to English | `templates/generic-rules.md` |
| `templates/node-rules.md` | MODIFY | LOW | Translate all review rules (~35 lines) to English | `templates/generic-rules.md` |
| `templates/flutter-rules.md` | MODIFY | LOW | Translate all review rules (~33 lines) to English | `templates/generic-rules.md` |
| `templates/laravel-rules.md` | MODIFY | LOW | Translate all review rules (~33 lines) to English | `templates/generic-rules.md` |
| `docs/specs/multi-llm-github-action/spec.md` | MODIFY | LOW | Translate all 602 lines of spec prose to English; preserve 20-section structure, headings, tables, and code blocks verbatim | This spec file |
| `CLAUDE.md` | MODIFY | **MEDIUM — see detail below** | Translate the TypeScript Coding Standards section and Testing with Vitest section from Spanish to English; translate Spanish section headings | The English sections already in CLAUDE.md |

### File detail

#### `src/prompts.ts` — critical: preserve runtime logic

- **What to translate:** The Spanish prose in the system prompt template string (role description, check category descriptions, severity scale labels, review instructions)
- **What NOT to touch:** The `if (config.language === 'es') { ... }` branch and the language instruction appended to the prompt — this controls LLM output language, not source language
- **Risk:** Accidentally removing the runtime `language` logic. After the change, the system prompt text is in English, but the LLM is still instructed to write reviews in the language set by `config.language`

#### `src/cli.ts` — critical: Commander descriptions stay Spanish

- **What to translate:** The `EXAMPLE_CONFIG` multiline template string (comments within the generated `.ai-review.yml`), and any `//` source comments
- **What NOT to touch:** `.command('review-pr', '...')`, `.option('--dry-run', '...')`, and any other Commander description strings — these appear in `--help` output and are user-facing. All chalk output strings stay Spanish.

#### `templates/*.md` — translate prose, preserve Markdown structure

- Preserve all H1, H2, H3 headings (translate their text)
- Preserve all bullet list structure and bold markers
- Translate all rule descriptions, explanations, and examples from Spanish to English
- Do not change file names

#### `docs/specs/multi-llm-github-action/spec.md` — translate prose, preserve spec structure

- Preserve all 20 section headings (translate their text)
- Preserve all tables (translate cell content)
- Preserve all code blocks verbatim — do not translate code, only prose
- Preserve checkboxes, bold markers, and all Markdown formatting

#### `CLAUDE.md` — translate Spanish sections only

- Sections already in English: "What This Is", "Build & Run", "Architecture", "Environment Variables", "ESM Module", "Language", "Spec First" — do not touch
- Sections to translate (headings AND prose):
  - `## TypeScript Coding Standards` — translate all subsection headings (e.g., "Prohibiciones absolutas" → "Absolute prohibitions", "Tipado" → "Typing", "Estructura de código" → "Code structure") and all rule descriptions
  - Code example markers: `// ✅ Correcto` → `// ✅ Correct`, `// ❌ Incorrecto` → `// ❌ Incorrect`
  - `## Testing con Vitest` → `## Testing with Vitest` — translate the heading itself and all rule descriptions (e.g., "Patrón AAA obligatorio" → "Mandatory AAA pattern", "Archivos cortos" → "Short files")
  - Code example markers inside the testing section follow the same rule

## 7. API Contract

Not applicable — this migration touches no API surface. No endpoints are added, changed, or removed.

## 8. Success criteria

- [ ] `npm run build` completes with zero TypeScript errors
- [ ] `npm run dev -- review-file src/types.ts` runs without crashing up to the LLM call (smoke test that templates load correctly; `OPENAI_API_KEY` must be set or a placeholder used — see verification commands)
- [ ] Zero Spanish comments remain in `src/` (grep check — see below)
- [ ] Zero Spanish content remains in `templates/` (grep check)
- [ ] `docs/specs/multi-llm-github-action/spec.md` reads naturally in English end-to-end
- [ ] `CLAUDE.md` Spanish sections are fully translated
- [ ] User-facing chalk output in `src/output.ts` and `src/cli.ts` is still in Spanish (regression check)
- [ ] `README.md` is unchanged

### Verification commands

Run all commands from the project root `/Volumes/Giolabs-Project/Work/Projects/code-review-ai` (or `cd` there first).

```bash
# 1. Build must pass
npm run build

# 2. Spanish diacritics grep — exclude files whose user-facing strings intentionally stay Spanish.
#    Should return zero lines. Any remaining hit is a missed translation.
cd /Volumes/Giolabs-Project/Work/Projects/code-review-ai && \
grep -rn "[áéíóúñüÁÉÍÓÚÑÜ]" src/ --include="*.ts" \
  | grep -v "^src/output\.ts:" \
  | grep -v "^src/reviewer\.ts:.*Recomendación del modelo" \
  | grep -v "^src/github\.ts:.*Observaciones adicionales\|^src/github\.ts:.*findings refieren"

# 3. Templates must be fully English — zero diacritics expected
cd /Volumes/Giolabs-Project/Work/Projects/code-review-ai && \
grep -rn "[áéíóúñüÁÉÍÓÚÑÜ]" templates/

# 4. Regression guard — confirm user-facing output.ts strings still contain Spanish
cd /Volumes/Giolabs-Project/Work/Projects/code-review-ai && \
grep -n "[áéíóúñüÁÉÍÓÚÑÜ]" src/output.ts
# Expected: several hits (Resumen, Recomendación, etc.). Zero hits = regression.

# 5. Smoke test — templates load and CLI runs without crashing
#    Requires OPENAI_API_KEY to be set in the environment; if not set, use a placeholder
#    to verify the config/template loading path (it will fail at the LLM call, not before).
OPENAI_API_KEY=${OPENAI_API_KEY:-placeholder} npm run dev -- review-file src/types.ts 2>&1 \
  | grep -v "API key" | head -20
```

### Required tests

No new test files are required for this migration — it contains zero logic changes. The existing build check and smoke test are sufficient to verify correctness.

## 9. UX Criteria

### Loading

Not applicable — no loading state changes.

### Forms

Not applicable.

### Passwords

Not applicable.

### Errors

Internal error messages in `throw new Error(...)` translate to English. These are developer-facing (stack traces, debug output) — users see the final chalk-formatted error in `output.ts`, which stays Spanish.

### Navigation

Not applicable — CLI structure unchanged.

### Accessibility

Not applicable.

## 10. Decisions made (locked)

| Decision | Why |
|---|---|
| Commander `.option()` descriptions stay Spanish | They appear verbatim in `--help` output — this is the primary interface end users read when discovering commands. Changing them to English would break the user experience for the target audience. |
| chalk output strings in `src/output.ts` and `src/cli.ts` stay Spanish | These are the runtime terminal messages the end user sees during a review. Per the `Language` rule in CLAUDE.md, user-facing CLI output stays Spanish. |
| `EXAMPLE_CONFIG` translates to English | The config template generated by `init` is developer documentation — the developer reads it to understand available options. It is not runtime output. Keeping it Spanish while all code is English creates an inconsistency. |
| System prompt in `src/prompts.ts` translates to English | The system prompt is code — it is LLM instructions authored by developers, not output seen by users. The LLM output language is controlled separately by `config.language`. |
| `README.md` stays Spanish | It is end-user documentation targeting the CLI's primary audience. |
| All 8 template files translate to English | Templates are LLM instructions (code), not user output. They will be read by developers maintaining them and by the LLM model. Neither benefits from Spanish. |
| Existing spec translates to English | Specs are developer artifacts. With English as the project language, having one spec in Spanish while all future specs are in English creates friction. |
| No translation CI check added | Out of scope for this phase. Can be added later via a pre-commit hook or lint rule. |
| Migrate all at once in a single PR | Incremental migration creates a period where some files are English and others Spanish, making it harder to know the current state. A single atomic PR is cleaner to review and verify. |

## 11. Edge cases

### Invalid data

Not applicable — no data handling changes.

### API errors

Not applicable.

### No connection / Timeout

Not applicable.

### Accidental translation of user-facing strings

**Risk:** A string that looks like an internal comment is actually interpolated into chalk output, or is embedded in a GitHub PR review comment body. Mitigation: after translation, run the CLI and verify the terminal output is still in Spanish. The three categories of user-facing strings that must stay Spanish are: (1) chalk output in `src/output.ts` and `src/cli.ts`, (2) Commander descriptions in `src/cli.ts`, (3) GitHub PR body strings in `src/reviewer.ts` (`'**Recomendación del modelo:**'`) and `src/github.ts` (`'### Observaciones adicionales'`, `'_(Estos findings refieren a líneas fuera del diff...)_'`).

### GitHub PR body strings

`src/reviewer.ts:156` contains `'**Recomendación del modelo:**'` embedded in the GitHub review body text. `src/github.ts:235,237` contain `'### Observaciones adicionales'` and `'_(Estos findings refieren a líneas fuera del diff...)_'`. These strings appear in the GitHub PR review comment visible to all GitHub users — they are user-facing output, not internal strings. **Do not translate them.** Only translate the surrounding `//` comments in those files.

### Translating the `language: es` runtime value in `EXAMPLE_CONFIG`

**Risk:** `EXAMPLE_CONFIG` in `src/cli.ts` contains a YAML line `language: es`. The Spanish character `es` here is the ISO code for the Spanish language — it is a runtime config *value*, not a Spanish word. Do **not** translate it to `language: en`. Only translate the surrounding YAML comments and descriptions. Similarly, the `DEFAULT_CONFIG` object in `src/config.ts` may contain `language: 'es'` — that value must not change.

### CLAUDE.md Spanish section headings

**Risk:** The heading `## Testing con Vitest` is a Spanish heading, not just Spanish prose. It must be renamed to `## Testing with Vitest`. Likewise, subsection headings like `### Prohibiciones absolutas`, `### Tipado`, `### Estructura de código` must all be translated. An agent that translates only the prose body and misses the headings leaves an inconsistent file.

### Code blocks in templates and specs

Code blocks (` ```ts ... ``` `) in template files and spec files must **not** be translated — code is language-neutral. Only prose outside code fences gets translated.

### `prompts.ts` language injection logic

The file has runtime logic like `${config.language === 'es' ? '...' : '...'}` that injects a language instruction into the prompt. After translation, the surrounding prompt prose is English but this conditional stays intact and functional. **Do not remove or alter this block.**

### Double submit

Not applicable.

## 12. Required UI states

Not applicable — no UI state changes. Terminal output behavior is unchanged.

## 13. Validations

### Client validations

Not applicable — no new input fields.

### Server validations

Not applicable.

## 14. Security & permissions

Not applicable — this migration touches no authentication, secrets, or permission checks.

## 15. Observability & logging

No changes to what is logged. Internal error messages that appear in stack traces translate to English, which improves readability for developers debugging issues. User-visible error output (chalk-formatted) stays Spanish and unchanged.

## 16. i18n / User-facing copy

The following strings are user-facing and must **not** be translated. They are listed here as a guard:

The table below lists known user-facing strings that must stay Spanish. It is **representative, not exhaustive** — the rule is: every `chalk.*()` call in `src/output.ts` and `src/cli.ts`, and every Commander `.command()`, `.option()`, `.description()`, `.alias()` string in `src/cli.ts`, stays Spanish regardless of whether it appears in this table.

| Location | String (keep Spanish) |
|---|---|
| `src/output.ts:36` | `'Resumen:'` |
| `src/output.ts:56` | `'Recomendación:'` |
| `src/output.ts:70` | `'Sugerencia:'` |
| `src/output.ts` markdown labels | All markdown report section headers (e.g., `'## 📋 Reporte de revisión'`) |
| `src/cli.ts` Commander descriptions | `'AI-powered code review para PRs de GitHub'`, all `.option()` descriptions |
| `src/cli.ts` chalk error/success output | All `chalk.red(...)`, `chalk.green(...)`, `chalk.yellow(...)` user messages |
| `src/cli.ts` console output | Any `console.log(...)` that is user-facing output (not internal debug) |

## 17. Performance

Not applicable — content-only migration with zero runtime behavior changes.

## 18. Restrictions

The implementer must NOT:

- [ ] Translate any chalk output string in `src/output.ts` or `src/cli.ts` to English
- [ ] Translate any Commander `.command()` or `.option()` description string to English
- [ ] Translate GitHub PR body strings: `'**Recomendación del modelo:**'` in `src/reviewer.ts`, or `'### Observaciones adicionales'` / `'_(Estos findings refieren a líneas fuera del diff...)_'` in `src/github.ts`
- [ ] Translate `README.md`
- [ ] Change any import paths, module names, or file names (including template file names)
- [ ] Alter any business logic, conditional branches, or function signatures
- [ ] Remove or modify the `config.language` runtime logic in `src/prompts.ts`
- [ ] Add new dependencies
- [ ] Translate code inside Markdown code fences in templates or specs
- [ ] Add JSDoc comments where none existed before
- [ ] Translate the `language: es` default value in config or the `DEFAULT_CONFIG` object (this is a runtime value, not source language)

## 19. Deliverables

- [ ] All `src/*.ts` files with comments and internal strings translated to English
- [ ] All 8 `templates/*.md` files fully translated to English
- [ ] `docs/specs/multi-llm-github-action/spec.md` translated to English
- [ ] `CLAUDE.md` Spanish sections translated to English
- [ ] `npm run build` passes with zero errors
- [ ] Grep checks confirm no Spanish diacritics remain in `src/` comments or `templates/`
- [ ] Smoke test confirms CLI still runs and chalk output is still in Spanish

## 20. Final agent checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] Only files listed in section 6 were modified
- [ ] Commander descriptions and chalk output in `src/cli.ts` and `src/output.ts` are still in Spanish
- [ ] `README.md` is unchanged
- [ ] Code blocks inside template and spec files were not translated
- [ ] `config.language` runtime logic in `src/prompts.ts` is intact and functional
- [ ] `npm run build` passes with zero TypeScript errors
- [ ] Smoke test: `npm run dev -- review-file src/types.ts` runs without crashing
- [ ] Grep check: no Spanish diacritics remain in `src/` (except intentional user-facing strings) or `templates/`
- [ ] No new dependencies added
- [ ] No logic changes — diff shows only string/comment content changes
