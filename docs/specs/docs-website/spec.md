# Documentation Website

> **Status:** DRAFT

## 1. Goal

Build a public documentation website for the `ai-code-reviewer` npm CLI tool using Starlight (Astro), hosted on GitHub Pages at `https://giolabs.github.io/ai-code-reviewer`. The site replaces the README as the primary reference for users, organizes the existing content into 12 pages with a themed sidebar, and adds three pages of content that don't exist today (troubleshooting, pre-commit hook setup, per-stack rule reference).

## 2. Scope

### Included in this phase

- Scaffold a Starlight v0.40.x site under `docs/` with its own `package.json` (isolated from root)
- Configure `astro.config.mjs` with sidebar groups, GitHub social link, and GitHub Pages `site`/`base`
- Create 12 content pages in `docs/src/content/docs/`:
  - `index.mdx` — landing page with hero, features grid, install snippet
  - `getting-started.md` — Quick Start (workflow YAML, API key, init, open a PR)
  - `local-usage.md` — `.env` setup, `npx` invocation, pre-commit hook wiring (new content)
  - `providers.md` — all four providers, secrets, default models, config snippets
  - `configuration.md` — full `.ai-review.yml` reference with all keys and defaults
  - `cli-reference.md` — `review-pr`, `review-file`, `review-diff`, `init` (all flags, exit codes)
  - `tech-stacks.md` — detection table + summary of built-in rules per stack (sourced from `templates/`)
  - `custom-rules.md` — writing `code-review-rules.md`, `customInstructions`, exceptions pattern
  - `design.md` — architectural decision rationale (4 items)
  - `limitations.md` — known limitations
  - `changelog.md` — stub with `0.1.0-beta.1` entry documenting current features
  - `troubleshooting.md` — common failures and fixes (new content; 6 scenarios minimum)
- Create `.github/workflows/deploy-docs.yml` — GitHub Actions workflow that builds and deploys to GitHub Pages on push to `main` when files under `docs/` change

### Out of scope

- Changing any file under `src/`, `templates/`, `examples/`, or `__test__/`
- Root `package.json` changes
- Multi-language (i18n) support — English only
- Multi-version docs (only latest / `0.1.0-beta.1`)
- Custom domain — deploy to `giolabs.github.io/ai-code-reviewer` (no CNAME)
- Auto-sync from README — docs are independent copies, not generated
- Algolia search or any paid search service — Pagefind (built into Starlight) is sufficient
- Any backend or API — purely static site
- Visual screenshots or video walkthroughs

## 3. Technologies & Project Conventions

### Stack

- **Framework**: Starlight v0.40.x (built on Astro 5.x)
- **Content format**: Markdown (`.md`) for most pages; MDX (`.mdx`) for the landing page only (hero component)
- **Deploy**: GitHub Pages via `actions/deploy-pages@v4`
- **Node**: ≥18.0.0 (matches root `engines` field)
- **Package manager**: npm

### Relevant versions

| Package | Version | Source |
|---|---|---|
| `@astrojs/starlight` | `^0.40.0` | `docs/package.json` (new) |
| `astro` | `^5.0.0` | `docs/package.json` (new) |
| Node.js | `>=18.0.0` | Root `package.json` `engines` |

### Existing patterns to follow

- `docs/` is a standalone project — its `package.json` does not reference the root package
- `astro.config.mjs` uses ESM (`export default defineConfig(...)`)
- Content files follow Starlight frontmatter: `title:` and optional `description:` fields — no other frontmatter keys needed for MVP
- Sidebar uses Starlight's `sidebar` array with `label` + `items` groups — see section 6 for the exact config

## 4. Prerequisites

- [x] `README.md` exists and is the content source for most pages
- [x] `templates/` has 8 stack rule files (reference for `tech-stacks.md`)
- [x] `examples/code-review-rules.md` exists (reference for `custom-rules.md`)
- [x] `examples/.ai-review.yml` exists (reference for `configuration.md`)
- [x] Root `package.json` `author` is `"Giolabs"` — GitHub org for the Pages URL
- [ ] GitHub repository must have Pages enabled: **Settings → Pages → Source → GitHub Actions** (manual step, done by repo owner before first deploy)
- [ ] `.github/workflows/` directory exists — already present (`examples/.github/workflows/ai-review.yml` implies the repo uses Actions)

## 5. Architecture

### Pattern

Static site generation (SSG). Starlight compiles Markdown/MDX to HTML at build time. No runtime server. GitHub Pages serves the `docs/dist/` output as a static site.

### Layers affected

| Layer | Affected? | Description |
|---|---|---|
| `docs/` | **Yes** — NEW | Entire Starlight project |
| `.github/workflows/deploy-docs.yml` | **Yes** — NEW | CI/CD deploy pipeline |
| Root `package.json` | No | Isolated |
| `src/` (main CLI) | No | |
| `templates/` | No | Read as content source, not modified |
| `examples/` | No | Read as content source, not modified |

### Expected build flow

1. Developer pushes to `main` with changes under `docs/**`
2. GitHub Actions workflow triggers
3. `npm ci` runs inside `docs/`
4. `astro build` compiles all `.md`/`.mdx` files to `docs/dist/`
5. Pagefind indexes the static output (runs automatically via Starlight)
6. `upload-pages-artifact` uploads `docs/dist/`
7. `deploy-pages` publishes to `https://giolabs.github.io/ai-code-reviewer`

### File layout (`docs/`)

```
docs/
  package.json
  astro.config.mjs
  tsconfig.json
  src/
    content/
      docs/
        index.mdx
        getting-started.md
        local-usage.md
        providers.md
        configuration.md
        cli-reference.md
        tech-stacks.md
        custom-rules.md
        design.md
        limitations.md
        changelog.md
        troubleshooting.md
    assets/
      (empty — no custom images required for MVP)
.github/
  workflows/
    deploy-docs.yml
```

## 6. Files to Create / Modify

| Path | Action | Purpose | Example to follow |
|---|---|---|---|
| `docs/package.json` | NEW | Starlight project dependencies and scripts | Root `package.json` structure |
| `docs/astro.config.mjs` | NEW | Starlight config: title, sidebar, GitHub link, Pages base | Starlight template default |
| `docs/tsconfig.json` | NEW | TypeScript config for Astro (`"extends": "astro/tsconfigs/strict"`) | Starlight template default |
| `docs/src/content/docs/index.mdx` | NEW | Landing page with hero + features | Starlight hero component docs |
| `docs/src/content/docs/getting-started.md` | NEW | Quick Start — from README §Quick start | README lines 22–77 |
| `docs/src/content/docs/local-usage.md` | NEW | Local usage + pre-commit hook (new content) | README §Local Usage |
| `docs/src/content/docs/providers.md` | NEW | All 4 providers — from README §Providers | README lines 79–111 |
| `docs/src/content/docs/configuration.md` | NEW | Full .ai-review.yml reference — from README §Configuration | README lines 114–138 |
| `docs/src/content/docs/cli-reference.md` | NEW | CLI commands and flags — from README §CLI commands | README lines 202–265 |
| `docs/src/content/docs/tech-stacks.md` | NEW | Stack detection + rules summary per stack | `templates/*.md` files |
| `docs/src/content/docs/custom-rules.md` | NEW | Writing code-review-rules.md and customInstructions | `examples/code-review-rules.md` |
| `docs/src/content/docs/design.md` | NEW | Design decisions — from README §Design decisions | README lines 291–304 |
| `docs/src/content/docs/limitations.md` | NEW | Known limitations — from README §Known limitations | README lines 307–312 |
| `docs/src/content/docs/changelog.md` | NEW | Changelog stub with 0.1.0-beta.1 entry | — |
| `docs/src/content/docs/troubleshooting.md` | NEW | Common failures and fixes (new content) | — |
| `.github/workflows/deploy-docs.yml` | NEW | GitHub Pages deploy workflow | `examples/.github/workflows/ai-review.yml` |

### Detail per file

#### `docs/package.json`

```json
{
  "name": "ai-code-reviewer-docs",
  "type": "module",
  "version": "0.0.1",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "@astrojs/starlight": "^0.40.0",
    "astro": "^5.0.0"
  }
}
```

Must NOT add the main package's dependencies here.

#### `docs/astro.config.mjs`

```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://giolabs.github.io',
  base: '/ai-code-reviewer',
  integrations: [
    starlight({
      title: 'ai-code-reviewer',
      description: 'AI-powered code reviewer for GitHub PRs — supports OpenAI, Anthropic, Gemini and Ollama',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/giolabs/ai-code-reviewer' }],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Quick Start', slug: 'getting-started' },
            { label: 'Local Usage', slug: 'local-usage' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Providers', slug: 'providers' },
            { label: 'Configuration', slug: 'configuration' },
            { label: 'CLI Reference', slug: 'cli-reference' },
            { label: 'Tech Stacks', slug: 'tech-stacks' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Custom Rules', slug: 'custom-rules' },
            { label: 'Design Decisions', slug: 'design' },
          ],
        },
        {
          label: 'About',
          items: [
            { label: 'Known Limitations', slug: 'limitations' },
            { label: 'Changelog', slug: 'changelog' },
            { label: 'Troubleshooting', slug: 'troubleshooting' },
          ],
        },
      ],
    }),
  ],
});
```

The `site` and `base` values are used by Astro to generate correct absolute URLs for GitHub Pages. Do not hardcode them in content files.

#### `docs/tsconfig.json`

```json
{
  "extends": "astro/tsconfigs/strict"
}
```

#### `docs/src/content/docs/index.mdx`

Hero landing page. Must include:
- Starlight `<Hero>` component with title `"AI Code Reviewer"`, tagline (from package.json description), and two actions: `"Get Started" → /ai-code-reviewer/getting-started` and `"GitHub" → https://github.com/giolabs/ai-code-reviewer`
- A `<CardGrid>` with 4 `<Card>` components summarizing the key features (dependency graph, multi-provider, inline comments, structured output)
- Install snippet:
  ```bash
  npx -y ai-code-reviewer@latest review-pr
  ```

#### Content pages (`getting-started.md` through `limitations.md`)

Each page must start with Starlight frontmatter:
```md
---
title: <Page Title>
description: <One sentence for SEO>
---
```

Content mapping:
- **`getting-started.md`**: README §Quick start steps 1–4, verbatim or lightly adapted. Include the full workflow YAML.
- **`local-usage.md`**: README §Local usage + a new sub-section "Pre-commit hook" showing how to wire `review-diff --staged` via a git hook (e.g., using `husky` or a raw `.git/hooks/pre-commit` shell script).
- **`providers.md`**: README §Providers. Expand the Ollama row to include a note about self-hosted models and pointing to `ollamaUrl` config key.
- **`configuration.md`**: README §Configuration — full YAML block + §Extended custom rules (README lines 114–181, includes both the full YAML and the custom rules sub-section).
- **`cli-reference.md`**: README §CLI commands — all four commands with flags and exit codes.
- **`tech-stacks.md`**: README §Supported tech stacks table + one sub-section per stack summarizing the 3 most important rules from that stack's template file (e.g., for NestJS: no business logic in controllers, DTOs need class-validator, repositories not from controllers). Do not copy all rules verbatim — summarize the spirit and link to `templates/` in the GitHub repo for the full list.
- **`custom-rules.md`**: How to write `code-review-rules.md`, the `customInstructions` YAML field, and the "exceptions" pattern. Use `examples/code-review-rules.md` as the embedded code example.
- **`design.md`**: README §Design decisions — 4 rationale items, verbatim.
- **`limitations.md`**: README §Known limitations — 4 items, verbatim.

#### `docs/src/content/docs/changelog.md`

```md
---
title: Changelog
description: Version history for ai-code-reviewer.
---

## 0.1.0-beta.1 — 2026-06-20

First public beta.

### Added
- Multi-provider support: OpenAI, Anthropic, Gemini, Ollama
- Dependency graph context for JS/TS stacks (1-level imports + importers via madge)
- Anticipated bugs and regression risk report in PR summary (`anticipatedBugs`, `regressionRisks`)
- Built-in review templates for 8 tech stacks (NestJS, Next.js, React, TypeScript, Node, Flutter, Laravel, Generic)
- Local commands: `review-file`, `review-diff --staged`, `review-diff --base <branch>`
- Configurable via `.ai-review.yml`: severity filter, ignore globs, max file size, check categories, custom rules
- Inline comments + PR summary with severity-coded findings
```

#### `docs/src/content/docs/troubleshooting.md`

New content. Must cover at least these 6 scenarios, each with a **Symptom**, **Cause**, and **Fix** structure:

1. **Action not triggering** — wrong event type (`push` instead of `pull_request`), or PR is a draft
2. **`Error: OPENAI_API_KEY is not set`** — secret name mismatch (common: `OPENAI_KEY` vs `OPENAI_API_KEY`)
3. **`Error: Missing permissions`** — `pull-requests: write` or `contents: read` not set in the workflow `permissions` block
4. **Diff truncated / partial review** — PR too large; fix: set `maxFileSize`, split the PR
5. **Ollama connection refused** — `ollamaUrl` misconfigured or service not running; fix: verify `http://localhost:11434` is reachable in the environment
6. **Exit code 1 blocking merge** — expected behavior when `request_changes`; fix: either resolve findings or configure branch protection to not require the check to pass

#### `.github/workflows/deploy-docs.yml`

```yaml
name: Deploy docs to GitHub Pages

on:
  push:
    branches: [main]
    paths: ['docs/**']
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: docs/package-lock.json
      - name: Install docs dependencies
        run: npm ci
        working-directory: docs
      - name: Build Starlight site
        run: npm run build
        working-directory: docs
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

The workflow only triggers when files under `docs/` change, avoiding unnecessary deploys on CLI source changes.

## 7. API Contract

Not applicable — static documentation site with no backend.

## 8. Success Criteria

- [ ] `cd docs && npm run build` exits 0 with no Astro errors
- [ ] `docs/dist/` contains an `index.html` and subdirectories for each of the 12 pages
- [ ] All 12 pages are reachable from the sidebar (no 404s in local preview via `npm run preview`)
- [ ] `cd docs && npm run dev` starts local dev server at `localhost:4321`
- [ ] `.github/workflows/deploy-docs.yml` runs successfully in CI (triggered by a push to `docs/**` on `main`)
- [ ] Deployed site is live at `https://giolabs.github.io/ai-code-reviewer`
- [ ] Pagefind search works — typing a keyword returns relevant pages
- [ ] No broken internal links (all `slug:` values in `astro.config.mjs` match actual file paths)

### Tests required

No automated test suite — verification is manual and via build output. The Astro build will fail on broken MDX/frontmatter syntax, which is the primary correctness check.

### Verification commands

```bash
cd docs
npm install
npm run build        # must exit 0
npm run preview      # smoke-test all 12 pages at localhost:4321
```

## 9. UX Criteria

### Navigation

- Sidebar groups must be in this order: Getting Started → Reference → Advanced → About
- The landing page (`/`) links to `getting-started` as the primary CTA
- Each page has a `title` in frontmatter so the browser tab and Starlight breadcrumb are populated

### Search

- Pagefind search is enabled automatically by Starlight — no config needed
- Verify search finds content from `configuration.md` (e.g., querying `minSeverity` returns a result)

### Code blocks

- All YAML, bash, and TypeScript/JavaScript code blocks must have a language hint (` ```yaml `, ` ```bash `, ` ```ts `) so Starlight applies syntax highlighting
- The workflow YAML on `getting-started.md` must be a fenced code block, not inline

### Mobile

- Starlight's default theme is mobile-responsive — no custom CSS needed for MVP

### Dark mode

- Starlight provides dark mode toggle out of the box — no custom CSS needed

## 10. Decisions Made (Locked)

| Decision | Why |
|---|---|
| Starlight over VitePress/Docusaurus | Zero-config Pagefind search, best out-of-box theme quality, one config file, most active release cadence (monthly) |
| `docs/` as a subdirectory, not a separate repo | Keeps docs co-located with the CLI; PRs can update docs and code together |
| Independent content copies, not README sync | Avoids brittle build scripts; docs can evolve beyond README without coupling |
| GitHub Pages, not Vercel | Free, no external account required, built-in with the repo |
| `paths: ['docs/**']` trigger | Prevents unnecessary deploys when only CLI source changes |
| English only | Consistent with README; maximizes npm discoverability |
| No custom CSS or theme overrides | Starlight defaults are sufficient for MVP; avoids maintenance burden |
| Pagefind (built-in) over Algolia | No account, no API key, works offline, zero config |
| `site` + `base` in `astro.config.mjs` | Required for correct absolute URLs on GitHub Pages subpath `/ai-code-reviewer` |

## 11. Edge Cases

### `site` / `base` mismatch

If `site: 'https://giolabs.github.io'` and `base: '/ai-code-reviewer'` are wrong, all internal links will 404. Verify with `npm run preview` before deploying.

### `docs/package-lock.json` missing

The workflow uses `cache-dependency-path: docs/package-lock.json`. The first run must generate the lockfile via `npm install` (not `npm ci`). Commit `docs/package-lock.json` to the repo.

### Starlight `social` API change

Starlight 0.40.x changed `social` from an object to an array of `{ icon, label, href }`. The config in section 6 already uses the new array format. Do not use the old object format.

### MDX vs Markdown

Only `index.mdx` uses MDX (for the `<Hero>` and `<CardGrid>` components). All other pages are plain `.md` — do not add `.mdx` extension unless a page actually imports Astro components.

### GitHub Pages not enabled

The first deploy will fail if GitHub Pages is not enabled in the repo settings. The prerequisite in section 4 must be completed by the repo owner before pushing the workflow.

## 12. Required UI States

| State | Description |
|---|---|
| Page loaded | Sidebar shows the current page highlighted; breadcrumb shows group → page title |
| Search open | Search modal opens on `Cmd+K`; results appear as user types (Pagefind) |
| Mobile | Hamburger menu replaces sidebar; all content readable without horizontal scroll |
| Dark mode | Toggle in header; persisted via `localStorage` |

## 13. Validations

Not applicable — no user input forms.

## 14. Security & Permissions

- The deploy workflow uses `id-token: write` (required for OIDC-based GitHub Pages deploy) — this is standard and does not grant additional repo access
- No secrets or API keys in any docs page — `OPENAI_API_KEY` etc. appear only as placeholder names (`sk-...`), never real values
- The workflow uses pinned action versions (`actions/checkout@v4`, `actions/deploy-pages@v4`) — do not use `@latest` or unpinned refs

## 15. Observability & Logging

Not applicable — static site. Build failures surface in GitHub Actions logs.

## 16. i18n / User-facing copy

All content in English. Key strings in `astro.config.mjs`:

| Field | Value |
|---|---|
| `title` | `ai-code-reviewer` |
| `description` | `AI-powered code reviewer for GitHub PRs — supports OpenAI, Anthropic, Gemini and Ollama` |
| GitHub social label | `GitHub` |
| Sidebar group: Getting Started | `Getting Started` |
| Sidebar group: Reference | `Reference` |
| Sidebar group: Advanced | `Advanced` |
| Sidebar group: About | `About` |

## 17. Performance

- Starlight generates static HTML — no JS bundle for content pages; fast initial load
- Pagefind index is generated at build time and lazy-loaded only when search is opened — no impact on initial page load
- `docs/` has its own `node_modules/` — keep it out of the root's workspace if one is ever added

## 18. Restrictions

The implementer must NOT:

- [ ] Modify any file outside `docs/` and `.github/workflows/deploy-docs.yml`
- [ ] Add CSS overrides or a custom Starlight theme — default theme only for MVP
- [ ] Copy `templates/*.md` files into `docs/` — reference them from `tech-stacks.md` by summarizing, not copying
- [ ] Use `@latest` for pinned GitHub Actions — use explicit major version tags (`@v4`)
- [ ] Add `docs/` to the root `package.json` `workspaces` field
- [ ] Commit `docs/node_modules/` or `docs/dist/` to git — add both to `.gitignore`
- [ ] Use the old Starlight `social` object format — use the array format (see section 6)
- [ ] Create more than 12 pages — scope is fixed for this phase
- [ ] Set `language: es` anywhere in the docs — English only

## 19. Deliverables

- [ ] `docs/package.json` with Starlight + Astro dependencies
- [ ] `docs/astro.config.mjs` with sidebar config, `site`, and `base`
- [ ] `docs/tsconfig.json`
- [ ] `docs/package-lock.json` (committed)
- [ ] `docs/src/content/docs/index.mdx` — landing page
- [ ] 11 content pages (`.md`) matching the sitemap in section 2
- [ ] `.github/workflows/deploy-docs.yml` — GitHub Pages deploy workflow
- [ ] `docs/node_modules/` and `docs/dist/` added to `.gitignore`
- [ ] `cd docs && npm run build` exits 0
- [ ] Local preview: all 12 pages load without 404

## 20. Final Agent Checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] `docs/package.json` has `"type": "module"` and only `@astrojs/starlight` + `astro` as dependencies
- [ ] `astro.config.mjs` has `site: 'https://giolabs.github.io'` and `base: '/ai-code-reviewer'`
- [ ] `astro.config.mjs` `social` uses array format `[{ icon, label, href }]`, not object format
- [ ] All 12 sidebar `slug:` values match actual files in `docs/src/content/docs/`
- [ ] Every `.md` page has `title:` and `description:` frontmatter
- [ ] All code blocks have a language hint
- [ ] `troubleshooting.md` covers all 6 scenarios with Symptom / Cause / Fix
- [ ] `changelog.md` has the `0.1.0-beta.1` entry with correct date `2026-06-20`
- [ ] `tech-stacks.md` summarizes rules from `templates/*.md` (does NOT copy files into docs)
- [ ] `cd docs && npm run build` exits 0
- [ ] `cd docs && npm run preview` — all 12 pages reachable, no 404s
- [ ] `.gitignore` excludes `docs/node_modules/` and `docs/dist/`
- [ ] No files outside `docs/` and `.github/workflows/deploy-docs.yml` were modified
- [ ] `docs/package-lock.json` is committed
