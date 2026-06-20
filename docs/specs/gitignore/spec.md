# Add .gitignore

> **Status:** DRAFT

## 1. Goal

Create a `.gitignore` file at the repository root so that build artifacts, local secrets, OS metadata, and generated directories are excluded from version control. Without this file, running `git status` after a build exposes `dist/`, `node_modules/`, and `.env` files as untracked — risking accidental commits of secrets or generated code.

## 2. Scope

### Included in this phase

- Create `.gitignore` at the repository root with patterns covering:
  - `node_modules/` — npm dependency directory
  - `dist/` — TypeScript build output (`tsc` → `dist/`)
  - `.env`, `.env.local`, `.env.*.local` — local secret files (`OPENAI_API_KEY`, `GITHUB_TOKEN`)
  - `.DS_Store` — macOS Finder metadata
  - `coverage/` — Vitest coverage output (pre-ignored to prevent future accidents)
  - `*.log`, `npm-debug.log*` — runtime log files

### Out of scope

- `BRIEF.md` and `.project-structure` — deliberate developer artifacts, remain tracked
- `examples/` — developer documentation (`code-review-rules.md`), remains tracked
- Windows OS files (`Thumbs.db`, `Desktop.ini`) — project is macOS-only
- IDE/editor configs (`.vscode/`, `.idea/`, `*.swp`) — not in scope for this phase
- `.env.example` — intentionally tracked sample; must NOT be ignored
- `package-lock.json` — committed for reproducible npm installs; must NOT be ignored
- Adding CI checks to enforce `.gitignore` coverage

## 3. Technologies & Project Conventions

### Stack

- **Language:** TypeScript (ESM, `"type": "module"`)
- **Runtime:** Node.js >= 18
- **Package manager:** npm (uses `package-lock.json`)
- **Build tool:** `tsc` (TypeScript compiler)
- **Test runner:** Vitest (planned, not yet installed)

### Relevant versions

| Dependency | Version | Source |
|---|---|---|
| typescript | ^5.6.0 | `package.json` |
| node | >= 18.0.0 | `package.json` engines |

### Existing patterns to follow

- No existing `.gitignore` — this is the first one
- `.env` loading via `dotenv` is referenced in `src/cli.ts` (line ~3, loads `.env` at startup)
- Build output target is `dist/` (`tsconfig.json`, `outDir: "dist"`)

## 4. Prerequisites

- [x] The project is a git repository (`.git/` exists at root)
- [x] `dist/` exists (created by `npm run build`)
- [x] `node_modules/` exists (created by `npm install`)
- [x] `.env` file is used locally for `OPENAI_API_KEY` (documented in `CLAUDE.md`)
- [x] No `.gitignore` exists at the repository root (confirmed — would be overwritten, not modified)

## 5. Architecture

### Pattern

Not applicable — `.gitignore` is a git configuration file with no application architecture impact.

### Layers affected

| Layer | Affected? | Description |
|---|---|---|
| Source files (`src/`) | No | No changes |
| Build output (`dist/`) | No | Already exists; now ignored by git |
| Templates (`templates/`) | No | No changes |
| Specs (`docs/`) | No | No changes |
| Git configuration | **Yes** | New `.gitignore` at repo root |

### Expected flow

1. Developer creates or modifies source files in `src/`
2. Developer runs `npm run build` → `dist/` is generated
3. `git status` shows only source changes — `dist/`, `node_modules/`, `.env`, `.DS_Store`, `coverage/`, and log files are invisible to git
4. Developer commits safely, with no risk of leaking secrets or committing build artifacts

### New file layout

```
/ (repo root)
  .gitignore     ← NUEVO
```

## 6. Files to Create / Modify

| Path | Action | Purpose | Example to follow |
|---|---|---|---|
| `.gitignore` | CREATE | Exclude build artifacts, secrets, OS files, and test coverage from version control | Standard Node.js `.gitignore` conventions |

### Detail per file

#### `.gitignore`

- **Responsibility:** Declare all patterns that git should never track in this repository
- **Example to follow:** Standard Node.js gitignore conventions (no existing project file to mirror — use industry standard)
- **Must NOT include:**
  - `src/` or any source directories
  - `templates/` — these are data files needed at runtime (published via `"files"` in `package.json`)
  - `package-lock.json` — required for reproducible installs
  - `.project-structure` — developer artifact, tracked intentionally
  - `BRIEF.md` — developer artifact, tracked intentionally
  - `examples/` — developer documentation, tracked intentionally
  - `.env.example` — sample file that should be committed as a template

**Required contents:**

```gitignore
# Dependencies
node_modules/

# Build output
dist/

# Environment variables — never commit secrets
.env
.env.local
.env.*.local

# OS metadata
.DS_Store

# Test coverage
coverage/

# Logs
*.log
npm-debug.log*
```

## 7. API Contract

Not applicable — this change has no API surface.

## 8. Success Criteria

- [ ] `.gitignore` file exists at the repository root
- [ ] `git status` after a clean `npm install && npm run build` shows no untracked entries for `node_modules/`, `dist/`, or `.DS_Store`
- [ ] `git check-ignore -v node_modules/` returns a match from `.gitignore`
- [ ] `git check-ignore -v dist/` returns a match from `.gitignore`
- [ ] `git check-ignore -v .env` returns a match from `.gitignore`
- [ ] `git check-ignore -v src/cli.ts` returns no match (source files remain tracked)
- [ ] `git check-ignore -v package-lock.json` returns no match (lock file remains tracked)
- [ ] `git check-ignore -v templates/generic-rules.md` returns no match (templates remain tracked)
- [ ] `npm run build` still passes after creating `.gitignore`

### Tests required

Not applicable — `.gitignore` is a git configuration file; no automated tests are written for it.

### Verification commands

```bash
# From the repo root:
cd /Volumes/Giolabs-Project/Work/Projects/code-review-ai

# Verify the file exists and contains key patterns
cat .gitignore

# Spot-check that key paths are ignored
git check-ignore -v node_modules/
git check-ignore -v dist/
git check-ignore -v .env
git check-ignore -v coverage/

# Spot-check that tracked files are NOT ignored
git check-ignore -v src/cli.ts
git check-ignore -v package-lock.json
git check-ignore -v templates/generic-rules.md
git check-ignore -v examples/code-review-rules.md

# Confirm build still passes
npm run build
```

## 9. UX Criteria

Not applicable — `.gitignore` is a developer configuration file with no user-facing interface.

## 10. Decisions Made (Locked)

| Decision | Why |
|---|---|
| `dist/` is ignored | Build output is generated — it should never be version-controlled. The npm package uses `"files"` in `package.json` to publish `dist/` directly; git tracking is irrelevant to publishing. |
| `package-lock.json` is NOT ignored | npm lock files must be committed for reproducible installs in CI and across machines. |
| `.env*` layered pattern (not just `.env`) | `.env.local` and `.env.*.local` are common dotenv layering conventions; ignoring them proactively prevents accidental secret leaks when the project adds more env layers later. |
| `coverage/` pre-ignored | Vitest is documented in `CLAUDE.md` as the chosen test runner. Pre-ignoring `coverage/` now costs nothing and prevents a future commit of test coverage artifacts. |
| `.DS_Store` only (no Windows files) | The dev team is macOS-only (confirmed). Adding Windows patterns would add noise without benefit. |
| `.project-structure` and `BRIEF.md` remain tracked | These are deliberate developer artifacts (project conventions and spec brief), not generated files. They belong in the repo. |
| `examples/` remains tracked | Contains `code-review-rules.md` — example developer documentation, not a scratch directory. |

## 11. Edge Cases

### Invalid patterns

- A pattern like `dist` (no trailing slash) still works for a directory, but `dist/` is more explicit and only matches directories — preferred to avoid accidentally ignoring a file named `dist` in the future.
- `.env.*` would match `.env.example` — must use `.env.*.local` (with `.local` suffix) to avoid ignoring the example file.

### API errors

Not applicable — no network requests involved.

### No connection

Not applicable.

### Timeout

Not applicable.

### Empty or unexpected response

Not applicable.

### Double submit

Not applicable.

### git check-ignore returns no match

- If `git check-ignore -v node_modules/` returns no match, the pattern is wrong. Check for trailing slash inconsistency or leading slash accidentally scoping the pattern.
- If `git check-ignore -v src/cli.ts` DOES return a match, the `.gitignore` accidentally ignores source files — fix immediately.

## 12. Required UI States

Not applicable — `.gitignore` is a git configuration file with no UI.

## 13. Validations

Not applicable — `.gitignore` has no form input or server validation.

## 14. Security & Permissions

- **Primary security goal:** Prevent accidental commits of `OPENAI_API_KEY` and `GITHUB_TOKEN` from `.env` files
- **Secret handling:** `.env`, `.env.local`, `.env.*.local` must all be ignored — these are the files where `OPENAI_API_KEY` is stored locally (per `CLAUDE.md`)
- **`.env.example` must remain tracked** — it is a template file that should be committed to guide contributors; it must NOT appear in `.gitignore`
- **`dist/` should be ignored** — while not a secret, publishing from git-tracked `dist/` is not the project's pattern; npm publish uses `"files"` in `package.json`
- **Permission checks:** Not applicable — no auth layer involved

## 15. Observability & Logging

Not applicable — `.gitignore` is a static configuration file that generates no logs.

## 16. i18n / User-facing Copy

Not applicable — `.gitignore` contains no user-facing strings. Comments within the file are developer-facing and must be in English (per the `Language` rule in `CLAUDE.md`).

## 17. Performance

Not applicable — `.gitignore` is evaluated by git on file system operations; there are no application-level performance considerations.

## 18. Restrictions

The implementer must NOT:

- [ ] Add `src/` or any source directory to `.gitignore` — source files must remain tracked
- [ ] Add `templates/` to `.gitignore` — template markdown files are runtime data and must be tracked
- [ ] Add `package-lock.json` to `.gitignore` — the lock file must be committed for reproducible installs
- [ ] Add `.env.example` to `.gitignore` — the example file is intentionally tracked as a contributor template
- [ ] Add `BRIEF.md` or `.project-structure` to `.gitignore` — these are intentional developer artifacts
- [ ] Add `examples/` to `.gitignore` — it contains committed developer documentation
- [ ] Add Windows OS patterns (`Thumbs.db`, `Desktop.ini`) — out of scope for this macOS-only project
- [ ] Add IDE configs (`.vscode/`, `.idea/`) — out of scope for this phase
- [ ] Modify any source files, templates, or configuration beyond `.gitignore`

## 19. Deliverables

- [ ] `.gitignore` file created at repository root with all required patterns (section 6)
- [ ] All success criteria verified (section 8: `git check-ignore` spot checks pass)
- [ ] `npm run build` still passes

## 20. Final Agent Checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] Confirmed `.gitignore` does not currently exist at the repo root (would be created, not modified)
- [ ] Modified only `.gitignore` — no other files changed
- [ ] All patterns from section 6 are present in the file
- [ ] `git check-ignore -v node_modules/` returns a match
- [ ] `git check-ignore -v dist/` returns a match
- [ ] `git check-ignore -v .env` returns a match
- [ ] `git check-ignore -v src/cli.ts` returns NO match
- [ ] `git check-ignore -v package-lock.json` returns NO match
- [ ] `git check-ignore -v examples/code-review-rules.md` returns NO match
- [ ] `npm run build` still passes
- [ ] No locked decisions (section 10) changed
- [ ] Comments in `.gitignore` are in English (per CLAUDE.md Language rule)
