# Nextra Docs Migration

> **Status:** DRAFT

## 1. Goal

Replace the existing Astro 6 + Starlight 0.40 documentation site under `docs/` with a Next.js 14 + Nextra 2 site that is bilingual (English default at `/`, Spanish at `/es/`), has a custom landing page, and includes expanded documentation with real working examples for every feature of `@giolabsuy/ai-code-reviewer`.

Users will be able to read docs in their preferred language, find complete working examples (workflow YAML, config snippets, CLI invocations) for every feature, and navigate a richer sidebar that covers handle-feedback, auto-approve, dependency graph, and multi-provider.

---

## 2. Scope

### Included in this phase

- Delete all Astro/Starlight files under `docs/` and replace with a Nextra 2 project
- Custom landing page (`pages/index.tsx`) using Tailwind CSS with hero, feature highlights, and quick-start snippet
- 15 English content pages (root-level, no prefix): migrate 13 existing + add `handle-feedback.mdx` and `auto-approve.mdx`
- 14 Spanish content pages under `pages/es/` (translated from English, rioplatense — no Spanish equivalent of `index.tsx`)
- Language switcher in the Nextra navbar (`theme.config.tsx`) toggling between `/` and `/es/`
- Nextra Flexsearch enabled for full-text search on both locales
- Update `.github/workflows/deploy-docs.yml` to build Next.js and export static HTML to `docs/out/`
- Deploy to GitHub Pages at `https://giolabs.github.io/ai-code-reviewer` (same URL as today)
- Add `docs/out/` and `docs/.next/` to `.gitignore`

### Out of scope

- Changes to any file under `src/`, `templates/`, `examples/`, or `__test__/`
- Root `package.json` changes
- Custom domain (no CNAME)
- More than 2 locales (English + Spanish only)
- Versioned docs (only latest beta)
- Video walkthroughs or screenshots
- Vercel deployment (GitHub Pages only)
- Auto-sync from `README.md` — content is maintained independently
- Algolia or any paid search service (Flexsearch only)

---

## 3. Technologies & Conventions

### Stack

| Role | Technology |
|---|---|
| Framework | Next.js 14 (App Router disabled — uses `pages/` router) |
| Docs theme | Nextra 2 (`nextra-theme-docs`) |
| Landing page styling | Tailwind CSS 3 |
| Search | Nextra built-in Flexsearch |
| Deploy | GitHub Pages via `next export` (`output: 'export'`) |
| Node | ≥18.0.0 |
| Package manager | npm |

### Relevant versions

| Package | Version | Rationale |
|---|---|---|
| `next` | `14.2.x` | Nextra 2 requires Next.js 13 or 14 |
| `nextra` | `2.13.4` | Latest stable Nextra 2; v3 breaks the i18n file structure |
| `nextra-theme-docs` | `2.13.4` | Must match `nextra` version exactly |
| `react` | `18.x` | Next.js 14 peer dep |
| `react-dom` | `18.x` | Next.js 14 peer dep |
| `tailwindcss` | `3.x` | Landing page only |
| `autoprefixer` | `10.x` | PostCSS plugin for Tailwind |
| `postcss` | `8.x` | PostCSS config required by Tailwind |
| `typescript` | `5.x` | `theme.config.tsx` and `pages/index.tsx` |
| `@types/react` | `18.x` | TypeScript types for React |
| `@types/node` | `20.x` | TypeScript types for Node |
| Node.js | `>=18.0.0` | Matches root `package.json` `engines` |

### Existing patterns to follow

- `docs/` is a standalone project — its `package.json` is independent from the root
- The existing Starlight content pages (`getting-started.md`, `configuration.md`, etc.) are the content source of truth for the migrated MDX files — match their factual content
- All code examples must match the actual CLI flags and config keys in `src/types.ts` and `src/cli.ts`
- CLAUDE.md: all code in English; user-facing copy in Spanish (rioplatense) for the `/es/` locale

---

## 4. Prerequisites

- [x] `docs/` directory exists with 13 Starlight content pages (content source for migration)
- [x] `src/types.ts` defines `ReviewerConfig`, `AutoApproveConfig`, `FeedbackConfig` (source of truth for config docs)
- [x] `templates/` has 8 stack rule files (source for `tech-stacks.mdx`)
- [x] `examples/code-review-rules.md` and `examples/.ai-review.yml` exist (source for `custom-rules.mdx`)
- [x] `.github/workflows/deploy-docs.yml` exists (will be rewritten for Next.js)
- [ ] GitHub repository Pages must be enabled: **Settings → Pages → Source → GitHub Actions** (manual step by repo owner — required before first deploy)

---

## 5. Architecture

### Pattern

Static Site Generation (SSG) via `next export`. Nextra compiles MDX pages to HTML at build time. GitHub Pages serves the `docs/out/` directory.

### i18n structure

Nextra 2 i18n does **not** use Next.js's built-in `i18n` routing (incompatible with `output: 'export'`). Instead, locale routing is done manually via directory structure:

- `pages/*.mdx` → English docs at `/getting-started`, `/configuration`, etc.
- `pages/es/*.mdx` → Spanish docs at `/es/getting-started`, `/es/configuration`, etc.
- `pages/index.tsx` → Landing page at `/` (custom, outside Nextra theme)
- Language switcher in `theme.config.tsx` detects current path and swaps `/es/` prefix

### Layers affected

| Layer | Affected? | Description |
|---|---|---|
| `docs/` | **Yes — FULL REWRITE** | Replace Astro with Nextra project |
| `.github/workflows/deploy-docs.yml` | **Yes — MODIFY** | Update for `next build && next export` |
| Root `package.json` | No | Isolated |
| `src/` (main CLI) | No | |
| `templates/` | No | Read as content source, not modified |
| `examples/` | No | Read as content source, not modified |

### Expected build flow

1. Developer pushes to `main` with changes under `docs/**`
2. GitHub Actions workflow triggers
3. `npm ci` inside `docs/`
4. `next build` compiles all MDX/TSX to `docs/.next/`
5. `next export` (via `output: 'export'`) writes static HTML to `docs/out/`
6. `upload-pages-artifact` uploads `docs/out/`
7. `deploy-pages` publishes to `https://giolabs.github.io/ai-code-reviewer`

### File layout (`docs/`)

```
docs/
  package.json
  next.config.js
  theme.config.tsx
  tailwind.config.js
  postcss.config.js
  tsconfig.json
  styles/
    globals.css
  pages/
    _app.tsx
    _meta.json              ← English sidebar config
    index.tsx               ← Custom landing page (Tailwind)
    getting-started.mdx
    local-usage.mdx
    providers.mdx
    configuration.mdx
    cli-reference.mdx
    tech-stacks.mdx
    custom-rules.mdx
    handle-feedback.mdx     ← NEW
    auto-approve.mdx        ← NEW
    design.mdx
    limitations.mdx
    changelog.mdx
    troubleshooting.mdx
    contributing.mdx
    es/
      _meta.json            ← Spanish sidebar config
      getting-started.mdx
      local-usage.mdx
      providers.mdx
      configuration.mdx
      cli-reference.mdx
      tech-stacks.mdx
      custom-rules.mdx
      handle-feedback.mdx
      auto-approve.mdx
      design.mdx
      limitations.mdx
      changelog.mdx
      troubleshooting.mdx
      contributing.mdx
```

---

## 6. Files to Create / Modify

| Path | Action | Purpose | Example to follow |
|---|---|---|---|
| `docs/package.json` | MODIFY | Replace Astro deps with Next.js 14 + Nextra 2 + Tailwind | Existing `docs/package.json` structure |
| `docs/next.config.js` | NEW | `output: 'export'`, `basePath`, `trailingSlash`, image unoptimized | Nextra template `next.config.js` |
| `docs/theme.config.tsx` | NEW | Logo, nav, footer, language switcher, Flexsearch | Nextra docs `theme.config.tsx` example |
| `docs/tailwind.config.js` | NEW | Tailwind content paths scoped to landing page only | Standard Tailwind v3 config |
| `docs/postcss.config.js` | NEW | Tailwind + autoprefixer plugins | Standard PostCSS config |
| `docs/tsconfig.json` | MODIFY | Next.js TypeScript config | Standard `tsconfig.json` with `"jsx": "preserve"` |
| `docs/styles/globals.css` | NEW | Tailwind directives (`@tailwind base/components/utilities`) | Standard Tailwind globals |
| `docs/pages/_app.tsx` | NEW | Import `globals.css`; wrap with Nextra theme | Nextra `_app.tsx` example |
| `docs/pages/_meta.json` | NEW | English sidebar order and labels | Nextra `_meta.json` docs |
| `docs/pages/index.tsx` | NEW | Custom landing page with hero, features, quick-start | Custom React + Tailwind |
| `docs/pages/getting-started.mdx` | MODIFY | Migrate from Starlight; add working YAML example | `docs/src/content/docs/getting-started.md` |
| `docs/pages/local-usage.mdx` | MODIFY | Migrate from Starlight | `docs/src/content/docs/local-usage.md` |
| `docs/pages/providers.mdx` | MODIFY | Migrate + expand with config examples for all 4 providers | `docs/src/content/docs/providers.md` |
| `docs/pages/configuration.mdx` | MODIFY | Migrate + annotate every field in `ReviewerConfig` | `docs/src/content/docs/configuration.md` + `src/types.ts` |
| `docs/pages/cli-reference.mdx` | MODIFY | Migrate from Starlight | `docs/src/content/docs/cli-reference.md` |
| `docs/pages/tech-stacks.mdx` | MODIFY | Migrate + add 3-rule summary per stack | `docs/src/content/docs/tech-stacks.md` + `templates/*.md` |
| `docs/pages/custom-rules.mdx` | MODIFY | Migrate from Starlight | `docs/src/content/docs/custom-rules.md` |
| `docs/pages/handle-feedback.mdx` | NEW | Document `/explain` and `/dismiss` commands, `handle-feedback` workflow | `src/feedback-handler.ts` |
| `docs/pages/auto-approve.mdx` | NEW | Document auto-approve config, conditions, dismiss behavior | `src/reviewer.ts` `shouldAutoApprove()` |
| `docs/pages/design.mdx` | MODIFY | Migrate from Starlight | `docs/src/content/docs/design.md` |
| `docs/pages/limitations.mdx` | MODIFY | Migrate from Starlight | `docs/src/content/docs/limitations.md` |
| `docs/pages/changelog.mdx` | MODIFY | Migrate + add `0.1.0-beta.4` entry | `docs/src/content/docs/changelog.md` |
| `docs/pages/troubleshooting.mdx` | MODIFY | Migrate + expand with Nextra-specific issues | `docs/src/content/docs/troubleshooting.md` |
| `docs/pages/contributing.mdx` | MODIFY | Migrate from Starlight | `docs/src/content/docs/contributing.md` |
| `docs/pages/es/*.mdx` | NEW (14 files) | Spanish translations of all 14 doc pages (no `es/index.tsx`) | Corresponding English page |
| `docs/pages/es/_meta.json` | NEW | Spanish sidebar labels | `docs/pages/_meta.json` |
| `.github/workflows/deploy-docs.yml` | MODIFY | Update for `next build`, static export to `docs/out/` | Existing `deploy-docs.yml` |

### Detail per file

#### `docs/package.json`

Replace Astro dependencies entirely:

```json
{
  "name": "ai-code-reviewer-docs",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.29",
    "nextra": "2.13.4",
    "nextra-theme-docs": "2.13.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.1",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.6.0"
  }
}
```

Must NOT include root package's dependencies. Must NOT set `"type": "module"` — Next.js uses CJS config files.

#### `docs/next.config.js`

```js
const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
})

module.exports = withNextra({
  output: 'export',
  basePath: '/ai-code-reviewer',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
})
```

`output: 'export'` is required for GitHub Pages. `trailingSlash: true` prevents 404s on GitHub Pages (which maps paths to `index.html`). `images.unoptimized: true` is required because Next.js image optimization does not work with static export.

#### `docs/theme.config.tsx`

Required fields:

```tsx
import { useRouter } from 'next/router'
import type { DocsThemeConfig } from 'nextra-theme-docs'

const config: DocsThemeConfig = {
  logo: <span>ai-code-reviewer</span>,
  project: {
    link: 'https://github.com/giolabs/ai-code-reviewer',
  },
  docsRepositoryBase: 'https://github.com/giolabs/ai-code-reviewer/tree/main/docs',
  useNextSeoProps() {
    return { titleTemplate: '%s – ai-code-reviewer' }
  },
  footer: {
    text: 'MIT License © Giolabs',
  },
  i18n: [
    { locale: 'en', text: 'English' },
    { locale: 'es', text: 'Español' },
  ],
}
export default config
```

The `i18n` array in `theme.config.tsx` renders the language switcher dropdown in the Nextra navbar. Note: this is Nextra's own `i18n` UI — it does NOT use Next.js's `i18n` config (incompatible with `output: 'export'`).

Nextra's `i18n` dropdown does **not** automatically remap paths. Implement a custom `navbar` component using `useRouter().asPath` to swap the `/es/` prefix:

```tsx
// inside theme.config.tsx
import { useRouter } from 'next/router'

// Replace the built-in i18n switcher with a custom component:
navbar: {
  extraContent: function LanguageSwitcher() {
    const { asPath } = useRouter()
    const isEs = asPath.startsWith('/es/')
    const target = isEs
      ? asPath.replace(/^\/es\//, '/')
      : '/es' + (asPath === '/' ? '/getting-started' : asPath)
    return (
      <a href={'/ai-code-reviewer' + target} style={{ marginLeft: 8 }}>
        {isEs ? 'English' : 'Español'}
      </a>
    )
  },
},
```

Remove the top-level `i18n` array from `theme.config.tsx` when using this custom switcher — they conflict.

#### `docs/pages/_meta.json`

```json
{
  "index": {
    "title": "Home",
    "display": "hidden"
  },
  "getting-started": "Quick Start",
  "local-usage": "Local Usage",
  "providers": "Providers",
  "configuration": "Configuration",
  "cli-reference": "CLI Reference",
  "tech-stacks": "Tech Stacks",
  "custom-rules": "Custom Rules",
  "handle-feedback": "Inline Feedback",
  "auto-approve": "Auto-Approve",
  "design": "Design Decisions",
  "limitations": "Known Limitations",
  "changelog": "Changelog",
  "troubleshooting": "Troubleshooting",
  "contributing": "Contributing"
}
```

#### `docs/tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/index.tsx',
    './styles/**/*.css',
  ],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
}
```

`content` is intentionally scoped to `pages/index.tsx` only. Do NOT add `./pages/**/*.{mdx,tsx}` — Nextra owns the CSS for MDX pages; including them would conflict with Nextra's theme styles.

#### `docs/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

#### `docs/pages/_app.tsx`

```tsx
import type { AppProps } from 'next/app'
import { ReactElement } from 'react'
import '../styles/globals.css'

export default function App({ Component, pageProps }: AppProps): ReactElement {
  return <Component {...pageProps} />
}
```

`globals.css` is imported here to apply Tailwind to the landing page. Nextra injects its own styles for MDX pages automatically via the theme wrapper — do NOT wrap `Component` in a Nextra layout component here.

#### `docs/pages/index.tsx`

Custom React page (outside Nextra theme). Must include:

- **Hero**: title "AI Code Reviewer", subtitle from `package.json` description, two buttons: "Get Started" (`/ai-code-reviewer/getting-started`) and "GitHub" (external)
- **Feature grid** (6 cards): Multi-provider (OpenAI/Anthropic/Gemini/Ollama), Inline comments, Auto-approve, Inline feedback (`/explain`, `/dismiss`), Dependency graph context, Custom rules per stack
- **Quick-start snippet**: the minimal workflow YAML in a styled code block
- **Language selector CTA**: links to `/es/` for Spanish readers
- `export default function HomePage()` — no Nextra theme wrapper

Do NOT import `nextra-theme-docs` layout in this file — it uses its own Tailwind layout.

#### `docs/pages/handle-feedback.mdx`

New content. Must cover:

1. **How it works** — when the bot leaves an inline comment, the developer can reply in the thread
2. **`/explain` command** — the bot replies with a deeper explanation of the finding; show an example reply screenshot or markdown mock
3. **`/dismiss` command** — the bot marks the finding as dismissed and resolves the thread; show expected behavior
4. **Setup** — the complete `handle-feedback` workflow YAML (already defined in the README / examples), the `feedback:` config block in `.ai-review.yml`
5. **Permissions** — why `pull-requests: write` is required
6. **Limitations** — only works on inline review comments (not general PR comments)

Code examples must match `src/feedback-handler.ts` behavior.

#### `docs/pages/auto-approve.mdx`

New content. Must cover:

1. **What it does** — when conditions are met, the bot posts a real GitHub `APPROVE` event and dismisses its own previous `CHANGES_REQUESTED` reviews
2. **Conditions** — model recommendation must be `approve`; no `critical` or `major` findings; `overallScore` (if present) must be ≥ `minScore`; `minor`/`info`/`nitpick` do NOT block
3. **Two-approval requirement** — auto-approve only counts as the bot's approval; a human approval is still required to merge
4. **Configuration** — the `autoApprove:` block in `.ai-review.yml`:
   ```yaml
   autoApprove:
     enabled: true
     minScore: 7
   ```
5. **What the bot logs** — the console messages from `src/reviewer.ts` (the green "Auto-aprobando" message and the yellow skip reason)
6. **Dismissed reviews** — the bot dismisses its own `CHANGES_REQUESTED` reviews with the message "Findings corregidos — review descartado automáticamente."

Code examples must match `shouldAutoApprove()` in `src/reviewer.ts`.

#### `docs/pages/configuration.mdx`

Must document every field in `ReviewerConfig` (from `src/types.ts`) with type, default, and example. Include:

| Field | Type | Default | Description |
|---|---|---|---|
| `provider` | `openai \| anthropic \| gemini \| ollama` | `openai` | LLM provider |
| `model` | `string` | `gpt-4o-mini` | Model ID for the selected provider |
| `providerModel` | `string` | — | Takes precedence over `model` |
| `ollamaUrl` | `string` | — | Ollama base URL (only for `ollama` provider) |
| `language` | `es \| en` | `es` | Review output language |
| `rules` | `string` | — | Path to custom rules markdown file |
| `tech` | TechStack | auto | Force a tech stack instead of auto-detect |
| `ignore` | `string[]` | (see defaults) | Glob patterns to ignore |
| `minSeverity` | Severity | `minor` | Minimum severity to include in output |
| `maxFileSize` | `number` | `100000` | Max file patch size in bytes |
| `checks` | `Record<CheckCategory, boolean>` | all enabled | Which check categories to run |
| `inlineComments` | `boolean` | `true` | Post inline comments on the PR |
| `summaryComment` | `boolean` | `true` | Post a general summary on the PR |
| `maxInlineComments` | `number` | `20` | Max number of inline comments per review |
| `customInstructions` | `string` | — | Extra prompt instructions appended to system prompt |
| `feedback.enabled` | `boolean` | `false` | Enable `/explain` and `/dismiss` commands |
| `feedback.allowDismiss` | `boolean` | `true` | Allow developers to dismiss findings |
| `autoApprove.enabled` | `boolean` | `false` | Enable auto-approve on clean re-review |
| `autoApprove.minScore` | `number` | `7` | Minimum `overallScore` (0–10) required |

#### `.github/workflows/deploy-docs.yml`

Replace Astro build step with Next.js:

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
      - name: Build and export
        run: npm run build
        working-directory: docs
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/out

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

Note: `next build` with `output: 'export'` writes to `docs/out/` by default. The artifact path must be `docs/out`, not `docs/dist`.

---

## 7. API Contract

Not applicable — static documentation site with no backend or API surface.

---

## 8. Success Criteria

- [ ] `cd docs && npm run build` exits 0 with no TypeScript or Next.js errors
- [ ] `docs/out/` contains `index.html` and subdirectories for all 15 English pages (including landing) and 14 Spanish pages
- [ ] All pages load in local preview (`npx serve docs/out`) without 404
- [ ] Language switcher toggles between English (`/ai-code-reviewer/getting-started`) and Spanish (`/ai-code-reviewer/es/getting-started`)
- [ ] Flexsearch returns results when typing `minSeverity` or `autoApprove` in the search box
- [ ] Landing page at `/` renders hero, feature grid, and quick-start snippet
- [ ] `handle-feedback.mdx` and `auto-approve.mdx` are reachable from the sidebar
- [ ] `.github/workflows/deploy-docs.yml` succeeds in CI and publishes to `https://giolabs.github.io/ai-code-reviewer`
- [ ] No broken internal links (all `_meta.json` keys match actual MDX file names)

### Tests required

No automated test suite — verification is manual and via build output. The Next.js build will fail on broken MDX syntax or missing imports, which is the primary correctness gate.

### Verification commands

```bash
cd docs
npm install
npm run build          # must exit 0; writes to docs/out/
npx serve out          # smoke-test all pages at localhost:3000
```

---

## 9. UX Criteria

### Navigation

- Sidebar order (from `_meta.json`): Quick Start → Local Usage → Providers → Configuration → CLI Reference → Tech Stacks → Custom Rules → Inline Feedback → Auto-Approve → Design Decisions → Known Limitations → Changelog → Troubleshooting → Contributing
- Active page is highlighted in the sidebar (Nextra handles this automatically)
- Breadcrumb shows page title (Nextra default)
- Landing page (`/`) is hidden from the sidebar (`"display": "hidden"` in `_meta.json`)

### Search

- Flexsearch is enabled by default in `nextra-theme-docs` — no additional config needed
- Verify search indexes both English and Spanish content
- Search is triggered by `Cmd+K` / `Ctrl+K`

### Language switcher

- Renders in the Nextra navbar (configured via `theme.config.tsx` `i18n` array)
- Switching language navigates to the same page slug in the target locale
- If a page does not exist in the target locale, falls back to the root locale page

### Code blocks

- All YAML, bash, TypeScript, and JSON code blocks must have a language hint (` ```yaml `, ` ```bash `, ` ```ts `, ` ```json `)
- `defaultShowCopyCode: true` in `next.config.js` (nextra option) enables copy button on all code blocks

### Mobile

- Nextra's default theme is mobile-responsive — no custom CSS needed for doc pages
- Landing page uses Tailwind responsive classes (`sm:`, `md:`, `lg:`) — verify on narrow viewport

### Dark mode

- Nextra provides a dark/light toggle in the navbar — no config needed
- Landing page must respect Nextra's dark mode: use Tailwind `dark:` variants for all background and text colors

### Accessibility

- All `<img>` elements on the landing page must have `alt` text
- Color contrast on the landing page must meet WCAG 2.1 AA (Tailwind defaults are sufficient)

---

## 10. Decisions Made (Locked)

| Decision | Why |
|---|---|
| Nextra 2 (not v3) | v3 changes the file structure and i18n API; the Nextra template repo (`shuding/nextra-docs-template`) targets v2; ecosystem maturity |
| Next.js 14 (not 15) | Nextra 2 is tested against Next.js 13–14; Next.js 15 may require Nextra 3 |
| `output: 'export'` (static) over Vercel SSR | Free, no external account, consistent with existing GitHub Pages setup; user explicitly chose GitHub Pages |
| English at `/` (no prefix) over `/en/` | Better SEO and npm discoverability; English is the primary target for open-source adoption |
| Spanish at `/es/` | Manual path prefix — compatible with `output: 'export'` (Next.js built-in `i18n` routing is incompatible with static export) |
| Tailwind for landing page only | Doc content pages use Nextra's built-in theme — Tailwind is scoped to `pages/index.tsx` to avoid conflicts with Nextra's CSS |
| `trailingSlash: true` | GitHub Pages serves files as `path/index.html`; without trailing slash, navigating directly to a URL returns 404 |
| Keep `docs/` in the main repo | Keeps docs co-located with CLI; PRs can update docs and code together |
| Flexsearch (built-in) over Algolia | No account, no API key, zero config, works with static export |
| `basePath: '/ai-code-reviewer'` | Site is at a subpath on GitHub Pages; required for all internal links to resolve correctly |

---

## 11. Edge Cases

### `basePath` mismatch

If `basePath: '/ai-code-reviewer'` is missing or wrong, all internal links and assets will 404 on GitHub Pages. Verify with `npx serve docs/out` using the base path.

### CJS vs ESM in `next.config.js`

`docs/package.json` must NOT have `"type": "module"`. Next.js config files (`next.config.js`, `tailwind.config.js`, `postcss.config.js`) use CommonJS `require()`. Adding `"type": "module"` causes "require is not defined" errors.

### Spanish pages missing

If a `pages/es/*.mdx` file is missing, navigating to `/es/<slug>` returns a 404. Every English page must have a corresponding Spanish file.

### Nextra `_meta.json` key mismatch

If a key in `_meta.json` does not match an actual `.mdx` filename, Nextra silently omits it from the sidebar or throws a build error. Verify all keys match filenames exactly (without the `.mdx` extension).

### Language switcher path mapping

Nextra's built-in `i18n` UI uses locale codes from `theme.config.tsx` but does NOT automatically remap the current path. The `locale` values (`'en'`, `'es'`) must map to the actual directory structure (`/` for English, `/es/` for Spanish). If Nextra's built-in switcher does not handle this, implement a custom `navbar` component in `theme.config.tsx` that uses `useRouter` to swap the `/es/` prefix.

### `docs/package-lock.json` missing from repo

The workflow uses `cache-dependency-path: docs/package-lock.json`. Run `npm install` inside `docs/` once and commit the lockfile. Without it, `npm ci` fails in CI.

### Image optimization

`images: { unoptimized: true }` must be set. Without it, `next build` with `output: 'export'` throws `Error: Image Optimization using the default loader is not compatible with export`.

---

## 12. Required UI States

| State | English | Spanish |
|---|---|---|
| Landing page | Hero + feature grid + quick-start visible | `/es/` CTA links to Spanish root |
| Doc page (idle) | Sidebar shows current page highlighted | Same, sidebar labels in Spanish |
| Search open | Modal opens on `Cmd+K`; results appear as user types | Indexes Spanish content too |
| Language switched | Navigates to same slug in target locale | Falls back gracefully if page missing |
| Mobile | Hamburger menu replaces sidebar; all content readable | Same |
| Dark mode | Toggle in navbar; persisted via `localStorage` | Same |
| 404 | Nextra default 404 page | Same (Nextra default) |

---

## 13. Validations

### Content accuracy

All CLI flags, config keys, and command names in the docs must match the actual source code:

- CLI commands: `src/cli.ts` (Commander definitions)
- Config fields: `src/types.ts` (`ReviewerConfig` interface)
- `autoApprove` conditions: `src/reviewer.ts` (`shouldAutoApprove()`)
- `feedback` behavior: `src/feedback-handler.ts`

### MDX syntax

Next.js build will fail on invalid MDX. All code blocks must be closed, all JSX expressions balanced.

### Locale completeness

Every file in `pages/*.mdx` must have a corresponding file in `pages/es/*.mdx`. Missing translations must be created (even if content is a translated stub with a "full translation coming" notice).

---

## 14. Security & Permissions

- The deploy workflow uses `id-token: write` (required for OIDC-based GitHub Pages deploy) — standard, does not grant additional repo access
- No real API keys or secrets in any docs page — `OPENAI_API_KEY`, `NPM_TOKEN`, etc. appear only as placeholder names, never real values
- Workflow uses pinned action versions (`@v4`) — do not use `@latest` or unpinned refs
- `docs/package.json` has `"private": true` — prevents accidental `npm publish` of the docs package

---

## 15. Observability & Logging

Not applicable — static site. Build failures surface in GitHub Actions logs under the "Build and export" step.

---

## 16. i18n / User-facing copy

### English (`pages/*.mdx` and `pages/_meta.json`)

All content in English. Sidebar labels from `_meta.json`:

| Key | Sidebar label |
|---|---|
| `getting-started` | `Quick Start` |
| `local-usage` | `Local Usage` |
| `providers` | `Providers` |
| `configuration` | `Configuration` |
| `cli-reference` | `CLI Reference` |
| `tech-stacks` | `Tech Stacks` |
| `custom-rules` | `Custom Rules` |
| `handle-feedback` | `Inline Feedback` |
| `auto-approve` | `Auto-Approve` |
| `design` | `Design Decisions` |
| `limitations` | `Known Limitations` |
| `changelog` | `Changelog` |
| `troubleshooting` | `Troubleshooting` |
| `contributing` | `Contributing` |

### Spanish (`pages/es/*.mdx` and `pages/es/_meta.json`)

All content in Spanish (rioplatense). Code blocks remain in English. Technical identifiers (config keys, CLI flags) remain in English. Sidebar labels in Spanish:

| Key | Sidebar label |
|---|---|
| `getting-started` | `Inicio rápido` |
| `local-usage` | `Uso local` |
| `providers` | `Proveedores` |
| `configuration` | `Configuración` |
| `cli-reference` | `Referencia CLI` |
| `tech-stacks` | `Stacks de tecnología` |
| `custom-rules` | `Reglas personalizadas` |
| `handle-feedback` | `Feedback en comentarios` |
| `auto-approve` | `Auto-aprobación` |
| `design` | `Decisiones de diseño` |
| `limitations` | `Limitaciones conocidas` |
| `changelog` | `Changelog` |
| `troubleshooting` | `Resolución de problemas` |
| `contributing` | `Contribuir` |

### Theme config strings (`theme.config.tsx`)

| Field | Value |
|---|---|
| Site title | `ai-code-reviewer` |
| Footer | `MIT License © Giolabs` |
| Language switcher — English | `English` |
| Language switcher — Spanish | `Español` |

---

## 17. Performance

- `next export` generates pre-rendered static HTML — no server-side rendering at request time; fastest possible initial load
- Flexsearch index is lazy-loaded only when the search modal opens — no impact on initial page load
- Tailwind CSS is purged at build time via `content` paths in `tailwind.config.js` — only used classes are included in the final CSS bundle
- `docs/` has its own `node_modules/` — keep it isolated from the root workspace; do not add `workspaces` to root `package.json`
- Large code examples in MDX are static strings — no runtime cost

---

## 18. Restrictions

The implementer must NOT:

- [ ] Modify any file outside `docs/` and `.github/workflows/deploy-docs.yml`
- [ ] Add `"type": "module"` to `docs/package.json` — breaks Next.js CJS config files
- [ ] Use Next.js built-in `i18n` routing in `next.config.js` — incompatible with `output: 'export'`
- [ ] Remove `output: 'export'` from `next.config.js` — required for GitHub Pages
- [ ] Remove `trailingSlash: true` from `next.config.js` — required for GitHub Pages path resolution
- [ ] Remove `images: { unoptimized: true }` — required for static export
- [ ] Import Tailwind in doc MDX pages — Tailwind is scoped to the landing page only
- [ ] Use `@latest` for GitHub Actions steps — use pinned `@v4` versions
- [ ] Delete `docs/src/content/docs/` before confirming the Nextra build passes — keep old Starlight content as reference until final cutover
- [ ] Commit `docs/node_modules/`, `docs/.next/`, or `docs/out/` to git
- [ ] Create a `pages/index.mdx` — the landing page must be `pages/index.tsx` (custom React component, not Nextra MDX)
- [ ] Use Nextra 3 or Next.js 15 — version mismatch breaks the theme

---

## 19. Deliverables

- [ ] `docs/package.json` with Next.js 14 + Nextra 2 + Tailwind dependencies
- [ ] `docs/next.config.js` with `output: 'export'`, `basePath`, `trailingSlash`, `images.unoptimized`
- [ ] `docs/theme.config.tsx` with logo, GitHub link, footer, Flexsearch, language switcher
- [ ] `docs/tailwind.config.js` and `docs/postcss.config.js`
- [ ] `docs/tsconfig.json`
- [ ] `docs/styles/globals.css` with Tailwind directives
- [ ] `docs/pages/_app.tsx` importing `globals.css`
- [ ] `docs/pages/index.tsx` — custom landing page (hero + features + quick-start)
- [ ] `docs/pages/_meta.json` — English sidebar
- [ ] 14 English MDX pages + `pages/index.tsx` (landing) under `docs/pages/`
- [ ] `docs/pages/es/_meta.json` — Spanish sidebar
- [ ] 14 Spanish MDX pages under `docs/pages/es/`
- [ ] `docs/package-lock.json` committed
- [ ] `.github/workflows/deploy-docs.yml` updated for `next build` + `docs/out/` artifact
- [ ] `docs/out/` and `docs/.next/` added to `.gitignore`
- [ ] `cd docs && npm run build` exits 0
- [ ] All 29 pages (15 EN including landing + 14 ES) load without 404 in local preview

---

## 20. Final Agent Checklist

Before delivering, verify:

- [ ] Read this spec end-to-end
- [ ] `docs/package.json` does NOT have `"type": "module"`
- [ ] `docs/package.json` has `"private": true`
- [ ] `next.config.js` has `output: 'export'`, `basePath: '/ai-code-reviewer'`, `trailingSlash: true`, `images: { unoptimized: true }`
- [ ] `theme.config.tsx` has `i18n: [{ locale: 'en', text: 'English' }, { locale: 'es', text: 'Español' }]`
- [ ] All 15 keys in `pages/_meta.json` match actual `.mdx` filenames
- [ ] All 15 keys in `pages/es/_meta.json` match actual `.mdx` filenames in `pages/es/`
- [ ] `pages/index.tsx` is a custom React component (NOT an MDX file)
- [ ] `handle-feedback.mdx` covers `/explain`, `/dismiss`, setup workflow, and permissions
- [ ] `auto-approve.mdx` covers conditions, `shouldAutoApprove()` logic, config block, dismiss behavior
- [ ] `configuration.mdx` documents every field in `ReviewerConfig` from `src/types.ts`
- [ ] All code blocks have a language hint (` ```yaml `, ` ```bash `, ` ```ts `, ` ```json `)
- [ ] No real API keys in any docs page
- [ ] `docs/package-lock.json` is committed
- [ ] `docs/out/` and `docs/.next/` are in `.gitignore`
- [ ] `cd docs && npm run build` exits 0
- [ ] `npx serve docs/out` — all 30 pages load, no 404s
- [ ] Language switcher toggles correctly between EN and ES pages
- [ ] Tailwind `dark:` variants used on landing page
- [ ] No files outside `docs/` and `.github/workflows/deploy-docs.yml` were modified
- [ ] Old Astro files (`astro.config.mjs`, `docs/src/`) are deleted before the final commit
