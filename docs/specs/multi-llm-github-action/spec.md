# Multi-LLM GitHub Action with Hierarchical Rules System

> **Status:** DRAFT

## 1. Goal

Transform `ai-code-reviewer` from a CLI that is run manually via `npx` in GitHub Actions into a **reusable GitHub Action** (`uses: giolabs/ai-code-reviewer@v1`) with support for multiple LLM providers (OpenAI, Anthropic Claude, Google Gemini, Ollama) through an Adapter pattern, and a hierarchical rules system where project rules take priority over global ones with per-category merging.

## 2. Scope

### Included in this phase

- Refactor of the OpenAI module to an Adapter pattern with abstract class `LLMAdapter`
- Implementation of 4 adapters: OpenAI, Anthropic, Gemini, Ollama
- Router/factory that selects the adapter based on configuration
- Rules merge system per category (project > global)
- Publication as a reusable GitHub Action with `action.yml`
- Dedicated entry point for the Action (`src/action.ts`)
- Standardized PR comment structure (fixed global format)
- Update of the `.ai-review.yml` configuration schema with fields `provider`, `providerModel`, `ollamaUrl`
- Backward compatibility: the CLI continues to work, OpenAI is the default

### Out of scope

- Dashboard or web UI — no visual interface in this phase
- GitHub App with webhook server, OAuth, or Marketplace — distributed as an Action
- Database or server-side persistence — everything is file-based
- Configurable comment format per project — fixed global format
- LLM response streaming
- Support for additional providers beyond the 4 defined
- Tests (defined in this spec but implemented in a later phase)
- Linter or CI pipeline for the project itself

## 3. Project technologies and conventions

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js >= 18
- **CLI framework**: Commander
- **HTTP/API clients**: `openai` SDK, `@anthropic-ai/sdk`, `@google/generative-ai`, native fetch (Ollama)
- **GitHub API**: `@octokit/rest`
- **Config**: js-yaml for `.ai-review.yml`
- **Output**: chalk for terminal
- **Module resolution**: Bundler (tsconfig `moduleResolution: "Bundler"`)

### Relevant versions

| Dependency | Version | Source |
|---|---|---|
| typescript | ^5.6.0 | `package.json` line 50 |
| openai | ^4.67.0 | `package.json` line 44 |
| @octokit/rest | ^21.0.0 | `package.json` line 39 |
| commander | ^12.1.0 | `package.json` line 41 |
| js-yaml | ^4.1.0 | `package.json` line 43 |
| chalk | ^5.3.0 | `package.json` line 40 |
| node | >=18.0.0 | `package.json` line 37 |
| @anthropic-ai/sdk | ^0.39.0 | NEW — Anthropic adapter |
| @google/generative-ai | ^0.21.0 | NEW — Gemini adapter |
| @actions/core | ^1.11.0 | NEW — GitHub Action logging and outputs |

### Existing patterns to respect

- Imports with `.js` extension even when the source is `.ts` (ESM convention)
- The current project uses pure functions. LLM adapters are implemented with OOP (classes) to encapsulate SDK client state. The rest of the new modules (`rules.ts`, `action.ts`, `json-parser.ts`) continue using exported functions, not classes
- Config merged over `DEFAULT_CONFIG` in `src/config.ts`
- Structured output via JSON schema in the LLM call
- Comments and CLI messages in Rioplatense Spanish

## 4. Prerequisites

- [ ] Active OpenAI account with API key (already existing)
- [ ] Anthropic account with API key for testing the Claude adapter
- [ ] Google AI Studio account with API key for testing the Gemini adapter
- [ ] Ollama installed locally for testing the Ollama adapter
- [ ] Repository published on GitHub (to test the Action)

## 5. Architecture

### Pattern

Adapter pattern with OOP for LLM providers + Factory for instantiation + Strategy for rules merging. Each provider is a class that implements the abstract class `LLMAdapter`. The factory instantiates the correct class based on the configured provider.

### Affected layers

| Layer | Affected? | Description |
|---|---|---|
| LLM adapters (new) | Yes | New layer `src/llm/` with interface + 4 implementations |
| Config | Yes | New fields `provider`, `providerModel`, `ollamaUrl` in ReviewerConfig |
| Rules engine (new) | Yes | New module `src/rules.ts` for hierarchical rules merging |
| Prompts | Yes | Refactor to receive already-merged rules instead of loading templates directly |
| Reviewer (orchestrator) | Yes | Replace direct call to `openai.ts` with the LLM router |
| GitHub integration | Yes | Update comment format to the new fixed standard |
| CLI | Yes | New entry point `src/action.ts` + add `--provider` option to the CLI |
| Output | Yes | Update summary format and inline comments |
| Types | Yes | New types for LLM adapter, provider config, merged rules |
| Tech detect | No | No changes |

### Expected flow

1. GitHub Action trigger: PR opened/updated triggers the workflow
2. `action.ts` reads Action inputs (optional overrides) and env vars (API keys from GitHub Secrets)
3. `reviewer.ts` loads `.ai-review.yml` from the repo — this is where the project defines `provider`, `model`, and other options
4. The final config is resolved: the repo's `.ai-review.yml` as base, with Action input overrides if provided
5. `rules.ts` loads project rules + global rules, merges them per category
6. `prompts.ts` builds the system prompt with the merged rules
7. LLM factory (`src/llm/factory.ts`) instantiates the adapter for the provider configured in `.ai-review.yml`
8. The adapter reads its API key from `process.env` (GitHub Secret) — the key is NOT in the config, only the provider
9. The adapter calls the LLM, parses the JSON response, and returns `ReviewResult`
10. `github.ts` posts the review with the standardized format

### Per-project configuration — examples

Each company/developer configures **which LLM to use** in the `.ai-review.yml` of their repo. The API key is configured as a GitHub Secret in their repo or organization.

**Example 1 — Company using Anthropic Claude:**

`.ai-review.yml` in the repo:
```yaml
provider: anthropic
model: claude-sonnet-4-5-20250514
language: en
minSeverity: minor
```

`.github/workflows/ai-review.yml`:
```yaml
- uses: giolabs/ai-code-reviewer@v1
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Example 2 — Startup using OpenAI (default, minimal config):**

`.ai-review.yml` in the repo:
```yaml
# provider: openai (default, no need to set it)
model: gpt-4o
language: es
```

`.github/workflows/ai-review.yml`:
```yaml
- uses: giolabs/ai-code-reviewer@v1
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Example 3 — Team with sensitive data using Ollama (local LLM on self-hosted runner):**

`.ai-review.yml` in the repo:
```yaml
provider: ollama
model: llama3.1
ollamaUrl: http://localhost:11434
language: es
```

`.github/workflows/ai-review.yml` (self-hosted runner with Ollama installed):
```yaml
- uses: giolabs/ai-code-reviewer@v1
  # No API key needed — Ollama runs locally
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Example 4 — Organization that configures the secret at org level:**

The secret `GEMINI_API_KEY` is configured once in **Organization → Settings → Secrets → Actions**, and all repos in the org inherit it.

`.ai-review.yml` in each repo:
```yaml
provider: gemini
model: gemini-2.0-flash
```

**Note:** in all examples `model:` is used for simplicity. `providerModel:` can also be used and is equivalent; if both are present, `providerModel` takes precedence (see section 10, decisions made).

**Summary of the circuit:**
- **Which LLM to use** → `.ai-review.yml` in the repo (committable, versionable, no sensitive data)
- **With which credential** → GitHub Secret in the repo or organization (secure, never in code)

### New file layout

```
src/
  llm/
    types.ts          # LLMAdapter abstract class, LLMConfig, ProviderName type
    factory.ts        # createLLMAdapter(provider, config) => LLMAdapter
    openai.ts         # OpenAI adapter (refactor of current src/openai.ts)
    anthropic.ts      # Anthropic/Claude adapter
    gemini.ts         # Google Gemini adapter
    ollama.ts         # Ollama adapter
    json-parser.ts    # JSON parsing with retry for providers without native json_schema
  rules.ts            # Hierarchical rules merge per category
  action.ts           # Entry point for GitHub Action
action.yml            # GitHub Action definition
```

## 6. Files to create or modify

| Path | Action | Purpose | Example to follow |
|---|---|---|---|
| `src/llm/types.ts` | NEW | LLMAdapter abstract class and router types | `src/types.ts` |
| `src/llm/factory.ts` | NEW | Factory that creates the adapter based on provider | -- |
| `src/llm/openai.ts` | NEW | OpenAI adapter (extracted from `src/openai.ts`) | current `src/openai.ts` |
| `src/llm/anthropic.ts` | NEW | Anthropic Claude adapter | `src/llm/openai.ts` |
| `src/llm/gemini.ts` | NEW | Google Gemini adapter | `src/llm/openai.ts` |
| `src/llm/ollama.ts` | NEW | Ollama adapter (local) | `src/llm/openai.ts` |
| `src/llm/json-parser.ts` | NEW | JSON parser with retry and validation | -- |
| `src/rules.ts` | NEW | Rules merge engine per category | `src/config.ts` (merge pattern) |
| `src/action.ts` | NEW | GitHub Action entry point | `src/cli.ts` |
| `action.yml` | NEW | GitHub Action definition for GitHub | -- |
| `src/openai.ts` | DELETE | Replaced by `src/llm/openai.ts` | -- |
| `src/types.ts` | MODIFY | Add `ProviderName`, update `ReviewerConfig` | -- |
| `src/config.ts` | MODIFY | Support new config fields (provider, providerModel, ollamaUrl) | -- |
| `src/reviewer.ts` | MODIFY | Use LLM factory instead of calling openai.ts directly | -- |
| `src/prompts.ts` | MODIFY | Receive merged rules, not load templates | -- |
| `src/github.ts` | MODIFY | Apply standardized comment format | -- |
| `src/output.ts` | MODIFY | Show provider used in terminal output | -- |
| `src/cli.ts` | MODIFY | Add `--provider` option | -- |

### Per-file detail

#### `src/llm/types.ts`

- **Responsibility**: Define the abstract class `LLMAdapter` that all providers extend, the `ProviderName` type, and `LLMConfig`
- **Example to follow**: `src/types.ts` (same style of exported types)
- **Do not mix**: Business logic, provider-specific SDK imports

```typescript
export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface LLMConfig {
  provider: ProviderName;
  model: string;
  ollamaUrl?: string;  // only for Ollama
  temperature?: number;
  // API keys do NOT go in config — they are read from env vars (GitHub Secrets)
  // Each adapter reads its key in validateConfig(): process.env.OPENAI_API_KEY, etc.
}

export interface LLMResponse {
  content: string; // JSON string of ReviewResult
  tokensUsed?: { prompt: number; completion: number; total: number };
}

/**
 * Abstract class that defines the contract for all LLM adapters.
 * Each provider extends this class and implements review().
 * The constructor receives LLMConfig and each subclass initializes its SDK client.
 */
export abstract class LLMAdapter {
  abstract readonly provider: ProviderName;
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  abstract review(args: { systemPrompt: string; userPrompt: string }): Promise<LLMResponse>;

  /** Validates that the config has everything needed for this provider (API key, model, etc). Throws a descriptive error if something is missing. */
  abstract validateConfig(): void;
}
```

#### `src/llm/factory.ts`

- **Responsibility**: Factory function `createLLMAdapter(config: LLMConfig): LLMAdapter` that instantiates the adapter class corresponding to the provider, calls `validateConfig()`, and returns the instance
- **Example to follow**: Classic factory pattern — switch on `config.provider`, instantiate `new OpenAIAdapter(config)`, etc.
- **Do not mix**: Parsing logic, API calls

#### `src/llm/openai.ts`

- **Responsibility**: Class `OpenAIAdapter extends LLMAdapter`. `validateConfig()` verifies that `process.env.OPENAI_API_KEY` exists. The constructor initializes the `OpenAI` client with the key read from the env var. Uses `response_format: json_schema` with the `REVIEW_SCHEMA` constant.
- **Example to follow**: Current `src/openai.ts` (refactored to class)
- **Do not mix**: Logic from other providers

#### `src/llm/anthropic.ts`

- **Responsibility**: Class `AnthropicAdapter extends LLMAdapter`. Initializes the `Anthropic` client in the constructor. Requests JSON in the system prompt. Parses the response with `json-parser.ts`. `validateConfig()` verifies that `ANTHROPIC_API_KEY` exists.
- **Example to follow**: `src/llm/openai.ts` (same class structure)
- **Do not mix**: OpenAI logic

#### `src/llm/gemini.ts`

- **Responsibility**: Class `GeminiAdapter extends LLMAdapter`. Initializes `GoogleGenerativeAI` in the constructor. Requests JSON in the prompt. Parses with `json-parser.ts`. `validateConfig()` verifies that `GEMINI_API_KEY` exists.
- **Example to follow**: `src/llm/openai.ts` (same class structure)
- **Do not mix**: Logic from other providers

#### `src/llm/ollama.ts`

- **Responsibility**: Class `OllamaAdapter extends LLMAdapter`. Uses native fetch against `config.ollamaUrl` (default `http://localhost:11434`). Requests JSON in the prompt. Parses with `json-parser.ts`. `validateConfig()` only verifies that `config.model` is non-empty and that `config.ollamaUrl` is a non-empty string — no network check. The connectivity error is thrown in `review()` when attempting the fetch.
- **Example to follow**: `src/llm/openai.ts` (same class structure)
- **Do not mix**: External dependencies — native fetch only

#### `src/llm/json-parser.ts`

- **Responsibility**: Function `parseReviewJSON(raw: string): ReviewResult` that extracts JSON from an LLM response, validates the structure, and retries with cleanup if the JSON is malformed. Parsing strategies in order:
  1. `JSON.parse(raw)` directly
  2. Strip markdown code fences (`` ```json ... ``` `` or `` ``` ... ``` ``) and re-parse
  3. Extract the first `{...}` substring with a balanced regex and re-parse
  If all 3 fail, throw an error with the first 200 chars of the raw response.
  After parsing, validate that the object has the required `ReviewResult` fields (`summary`, `findings`, `recommendation`).
- **Do not mix**: API calls

#### `src/rules.ts`

- **Responsibility**: Hierarchical rules merge per category
- **Example to follow**: `src/config.ts` (merge-over-defaults pattern)
- **Do not mix**: General config loading, prompt construction

**`CategoryRules` type:**

```typescript
/** Rules parsed per category. Each key is a CheckCategory, the value is the markdown text of the rules for that category. */
export type CategoryRules = Partial<Record<CheckCategory, string>>;
```

**Functions:**

- `loadProjectRules(cwd): CategoryRules` — Reads the project's `code-review-rules.md` (referenced in `.ai-review.yml` via `rules:`). The file is parsed by H2 sections whose title matches a `CheckCategory` (e.g.: `## security`, `## performance`). Content not under a category H2 is assigned to a special key `_general`. If there is no rules file, returns `{}`.
- `loadGlobalRules(tech: TechStack): CategoryRules` — Reads the built-in template from `templates/<tech>-rules.md`. Parsed with the same H2 section-by-category logic.
- `mergeRules(project: CategoryRules, global: CategoryRules, enabledChecks: Record<CheckCategory, boolean>): string` — For each category enabled in `enabledChecks`: if `project[cat]` exists and is not empty, uses that; otherwise uses `global[cat]`. Concatenates everything into a single markdown string with category headers, ready to inject into the system prompt.

**Concrete merge example:**

```
# Input
project = { security: "Do not use dynamic execution functions...", performance: "" }
global  = { security: "OWASP top 10...", performance: "Avoid N+1 queries...", maintainability: "DRY..." }
enabledChecks = { security: true, performance: true, maintainability: true, ... }

# Output (string)
## security
Do not use dynamic execution functions...  <- project wins (has content)

## performance
Avoid N+1 queries...                       <- global wins (project is empty)

## maintainability
DRY...                                     <- global wins (project does not define this category)
```

#### `src/action.ts`

- **Responsibility**: Entry point for `action.yml`. Reads GitHub Action inputs (`INPUT_*` env vars), maps them to CLI options, and calls `reviewPullRequest()`. Writes outputs to the `$GITHUB_OUTPUT` file (do NOT use `::set-output` which is deprecated). Do NOT call `dotenv/config` — in Actions the secrets come from the runner.
- **Exposed outputs**: `review-posted` (true/false), `findings-count` (number), `recommendation` (approve/comment/request_changes)
- **Example to follow**: `src/cli.ts` (entry point pattern)
- **Do not mix**: Review logic

#### `action.yml`

- **Responsibility**: GitHub Action definition for GitHub
- **Runs block**: `using: 'node20'`, `main: 'dist/action.js'` — `dist/` is committed to the repo (pre-built, as is convention in GitHub Actions)
- **Inputs**: `provider` (optional, override from `.ai-review.yml`), `model` (optional, override), `language` (default: es), `tech` (optional), `config-path` (optional), `rules-path` (optional), `min-severity` (default: minor), `dry-run` (default: false). All inputs are optional overrides — the main configuration lives in the user's repo's `.ai-review.yml`.
- **Secrets via env vars**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` — the user configures them as GitHub Secrets in their repo or organization and passes them in the `env:` block of the workflow step
- **Outputs**: `review-posted` (boolean string), `findings-count` (number string), `recommendation` (approve/comment/request_changes)
- **Do not mix**: Business logic

## 7. API Contract

No API surface — not applicable. This project is a CLI/GitHub Action that consumes external APIs (OpenAI, Anthropic, Gemini, Ollama, GitHub) but does not expose its own endpoints.

## 8. Success criteria

- [ ] `npm run build` compiles without errors
- [ ] Running `review-file` with `--provider openai` produces a review identical to the current behavior
- [ ] Running `review-file` with `--provider anthropic` produces a valid review with ReviewResult structure
- [ ] Running `review-file` with `--provider gemini` produces a valid review with ReviewResult structure
- [ ] Running `review-file` with `--provider ollama` (with Ollama running locally) produces a valid review
- [ ] If the project defines custom rules for `security`, the global security rules are NOT applied
- [ ] If the project does NOT define rules for `performance`, the global performance rules ARE applied
- [ ] The Action can be used in a workflow with `uses: giolabs/ai-code-reviewer@v1` and posts a review on the PR
- [ ] The CLI continues to work without changes for existing users (backward compat with `--provider` defaulting to `openai`)
- [ ] The PR comment format follows the standardized global structure

### Required tests

| Test file | Scenarios |
|---|---|
| `test/llm/factory.test.ts` | Creates correct adapter per provider, throws error on invalid provider |
| `test/llm/json-parser.test.ts` | Parses clean JSON, JSON with code fences, invalid JSON with retry, unrecoverable JSON |
| `test/rules.test.ts` | Merge with complete project rules, partial merge per category, no project rules, no global rules |
| `test/config.test.ts` | Config with provider/providerModel, config without provider (default openai), config with ollamaUrl |

### Verification commands

```bash
npm run build
# No linter or tests configured yet — to be added in a later phase
```

## 9. UX criteria

### Loading

- The CLI prints `Calling <ProviderName>...` (e.g.: `Calling Anthropic Claude...`) during the LLM call
- In Action mode, there is no interactive output — only Actions logs

### Forms

Not applicable — no forms.

### Passwords

Not applicable.

### Errors

- Missing API key: provider-specific error with instructions on how to configure it
- Unrecognized provider: `Error: Provider '<name>' not supported. Options: openai, anthropic, gemini, ollama`
- JSON parsing failure (after retries): `Error: Could not parse response from <provider>. Raw response: <first 200 chars>`
- Ollama unavailable: `Error: Could not connect to Ollama at <url>. Make sure Ollama is running.`

### Navigation

Not applicable — it is a CLI.

### Accessibility

Not applicable — it is a CLI.

## 10. Decisions made

| Decision | Why |
|---|---|
| Adapter pattern with classes (OOP) | Adapters are implemented as classes that implement the `LLMAdapter` abstract interface. The factory instantiates the correct class. This allows encapsulating SDK client state (API key, config) in the constructor and exposing a clean contract via the interface |
| API keys exclusively via GitHub Secrets (env vars) | Keys are never read from repo files (neither `.env` nor `.ai-review.yml`). In the Action context, they come from GitHub Secrets; in local CLI, from shell env vars. This prevents keys from being accidentally committed |
| JSON parse with retry instead of tool/function calling | Gemini and Ollama do not have uniform function calling support; JSON in prompt is the lowest common denominator |
| OpenAI keeps `response_format: json_schema` | It is more reliable than JSON in prompt; do not degrade a provider that already works well |
| Rules merge per category, not total override | Allows a project to customize only what it needs without losing the global rules for the rest |
| GitHub Action (not GitHub App) | Does not require its own server, simpler to distribute, the user controls their runner and secrets |
| Fixed PR comment format, not configurable | Reduce complexity in phase 1; can be made configurable later |
| Ollama config via `ollamaUrl` in `.ai-review.yml` | Consistent with the rest of the file-based config; no need to add unnecessary env vars |
| `requireApiKey` per provider instead of a generic validator | Each provider needs different error messages with specific instructions |
| Separate `action.ts` entry point for the Action | Separate concerns: the CLI has Commander, the Action reads `INPUT_*` env vars — mixing them complicates both |
| `model` in config is kept as an alias for `providerModel` | Backward compat: existing configs with `model: gpt-4o-mini` continue to work. `providerModel` takes precedence if both are present. `DEFAULT_CONFIG` now has `provider: 'openai'` and `model: 'gpt-4o-mini'` (without `providerModel`). The resolver in config.ts reads `providerModel ?? model` |
| `action.ts` does NOT call `dotenv/config` | In GitHub Actions the secrets come from the runner; loading `.env` could overwrite env vars or leak data |
| `dist/` is committed to the repo | Standard convention for GitHub Actions — the Action executes `dist/action.js` directly without a build step |
| UI strings hardcoded in Spanish, no i18n system | The project has no formal i18n. The `language` config field controls the review language (what the LLM writes), not the CLI UI |

## 11. Edge cases

### Invalid data

- Config with invalid `provider`: error with list of valid providers
- Config with empty `model` for a provider: use the adapter's default model:
  - OpenAI: `gpt-4o-mini`
  - Anthropic: `claude-sonnet-4-5-20250514`
  - Gemini: `gemini-2.0-flash`
  - Ollama: no default — throw error `Model required for Ollama. Specify it in providerModel or model.`
- `ollamaUrl` with malformed URL: error when trying to connect, do not validate format

### API errors

- **400**: `Provider error: invalid request. Check model and configuration.` + raw error message
- **401**: `Authentication error with <provider>. Verify that the API key is valid.`
- **403**: `Access denied by <provider>. Verify API key permissions.`
- **404**: `Model '<model>' not found in <provider>. Verify the model name.`
- **429**: `Rate limit from <provider>. Wait and try again, or use another provider.`
- **500**: `Internal error from <provider>. Retry or switch provider.`

### No connection

- Network error: `Connection error with <provider>. Check internet connectivity.`
- Ollama offline: `Could not connect to Ollama at <url>. Verify that the service is running.`

### Timeout

- Default 120s timeout on the LLM call. If exceeded: `Timeout: <provider> did not respond within 120 seconds. Try with a smaller model or reduce the diff size.`

### Empty or unexpected response

- Empty LLM response: `Error: <provider> returned an empty response.`
- Valid JSON but does not match ReviewResult: `Error: The response from <provider> does not have the expected structure. Missing fields: <list>`
- JSON with markdown code fences: `json-parser.ts` strips them before parsing (common case with Gemini and Ollama)

### Double submit

Not applicable — each execution is independent and stateless.

## 12. Required UI states

Not applicable in the traditional UI sense. The relevant CLI states are:

| State | What is shown | User can... |
|---|---|---|
| idle | Nothing (CLI waiting for command) | Execute any command |
| loading | `Calling <Provider>...` | Wait (Ctrl+C to cancel) |
| success | Complete review with findings | Read output, save with `--save` |
| error | Error message with context | Fix config and retry |
| empty | `No files to review...` | Check ignore filters |

## 13. Validations

### Client-side validations

| Field | Rule | Message |
|---|---|---|
| `provider` | Must be `openai`, `anthropic`, `gemini`, or `ollama` | `Provider '<value>' not supported. Options: openai, anthropic, gemini, ollama` |
| Provider API key | Must exist as env var provided via GitHub Secrets (except Ollama which requires no key) | `<PROVIDER>_API_KEY is not defined. Add it as a secret in your repo (Settings > Secrets > Actions).` |
| `ollamaUrl` | Must be a valid URL if provider is ollama | Connection error when attempting to call |
| `providerModel` | Optional; if not provided, uses the adapter's default | -- |

### Server-side validations

Not applicable — there is no own server. External API validations are handled in edge cases (section 11).

## 14. Security and permissions

- **Secrets**: All API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) are read **exclusively** from env vars provided by GitHub Secrets in the repository workflow. They are NOT read from `.env` files, `.ai-review.yml`, or any other repo file. Keys are never logged, never included in output, and never persisted to disk.
- **Workflow configuration**: The user configures the keys in **Settings → Secrets and variables → Actions** of their repo/organization, and passes them in the step's `env:` block:
  ```yaml
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  ```
- **Local CLI**: For local use via `npm run dev`, keys are read from shell env vars (exported manually or via `.env` with dotenv only in the CLI entry point, never in the Action entry point).
- **Sensitive payloads**: The PR source code is sent to the chosen LLM. The user is responsible for choosing a provider that complies with their data policies.
- **Permission checks**: The Action requires `pull-requests: write` and `contents: read` in the workflow.
- **401/403 flow**: Clear error with instructions on how to configure the API key in GitHub Secrets. No automatic retry on auth errors.
- **Ollama**: Runs locally, does not send data outside the user's network. Does not require an API key. This is mentioned in the documentation as an advantage for repos with sensitive code.

## 15. Observability and logging

- **Log**: Provider used, model, number of files, tokens consumed (at the end of each review). In Action mode, use `core.info()` from `@actions/core`.
- **Never log**: API keys, full file contents, raw prompts (they are very long). Log metadata only.
- **Mechanism**: `console.log` with chalk for CLI (existing in `src/output.ts`). For the Action entry point, `@actions/core` for structured Actions logging.
- **DEBUG mode**: When `DEBUG=true`, print the full system prompt and user prompt (already existing, extend to all providers).

## 16. i18n / visible strings

| Key | Text |
|---|---|
| `provider_loading` | `Calling {provider}...` |
| `provider_not_supported` | `Provider '{name}' not supported. Options: openai, anthropic, gemini, ollama` |
| `api_key_missing_openai` | `OPENAI_API_KEY is not defined. Add it as a secret in your repo (Settings > Secrets > Actions) and pass it in the workflow env block.` |
| `api_key_missing_anthropic` | `ANTHROPIC_API_KEY is not defined. Get one at console.anthropic.com and add it as a secret in your repo (Settings > Secrets > Actions).` |
| `api_key_missing_gemini` | `GEMINI_API_KEY is not defined. Get one at aistudio.google.com and add it as a secret in your repo (Settings > Secrets > Actions).` |
| `ollama_connection_error` | `Could not connect to Ollama at {url}. Make sure it is running.` |
| `json_parse_error` | `Could not parse response from {provider}.` |
| `review_header` | `## 🤖 AI Code Review` |
| `rules_merge_info` | `Rules: {projectCount} from project + {globalCount} global` — emitted by `src/output.ts` in the terminal output alongside the review header (loading section, after `Calling {provider}...`) |

*Note: this project does not use a formal i18n system. Strings are hardcoded in Spanish. The `language` config field changes the review language (what the LLM writes), not the CLI UI language.*

## 17. Performance

- **API calls**: A single LLM call per review (do not change). 120s timeout.
- **Retry**: Only for JSON parsing (up to 2 re-parses of the same string). Do NOT re-call the LLM if the response is invalid — it is expensive.
- **Main thread**: Everything runs on the main thread (Node single-threaded). Async calls are I/O-bound to the LLM.
- **Caching**: No caching. Each review is independent and stateless.
- **Bundle size**: Adding 3 new dependencies (`@anthropic-ai/sdk`, `@google/generative-ai`, `@actions/core`). Ollama requires no SDK.

## 18. Constraints

The implementor MUST NOT:

- [ ] Add an HTTP server or database
- [ ] Make the Action require permissions beyond `pull-requests: write` and `contents: read`
- [ ] Re-call the LLM when JSON parsing fails (only re-parse the already-obtained string)
- [ ] Change the default behavior: without `--provider`, it must be OpenAI with `gpt-4o-mini`
- [ ] Log API keys or full file contents
- [ ] Read API keys from repo files (`.env`, `.ai-review.yml`, etc.) — env vars only
- [ ] Call `dotenv/config` from `src/action.ts` (in Actions the secrets come from the runner)
- [ ] Add dependencies beyond the 3 listed (`@anthropic-ai/sdk`, `@google/generative-ai`, `@actions/core`)
- [ ] Change the `.ai-review.yml` format in a way that breaks existing configs
- [ ] Make the PR comment format configurable (it is fixed global in this phase)
- [ ] Add LLM response streaming

## 19. Deliverables

- [ ] `src/llm/` module with interface, factory, and 4 adapters
- [ ] `src/rules.ts` module with hierarchical merge per category
- [ ] `src/action.ts` entry point for the GitHub Action
- [ ] `action.yml` file at the repo root
- [ ] Modifications to `src/types.ts`, `src/config.ts`, `src/reviewer.ts`, `src/prompts.ts`, `src/github.ts`, `src/output.ts`, `src/cli.ts`
- [ ] Deletion of `src/openai.ts` (replaced by `src/llm/openai.ts`)
- [ ] Update of `README.md` with multi-provider documentation and usage as an Action
- [ ] Update of `package.json` with new dependencies

## 20. Final checklist for the agent

Before delivering, verify:

- [ ] Read this spec from start to finish
- [ ] Confirm that all prerequisites (section 4) exist
- [ ] Only modify the files listed in section 6
- [ ] Follow the real project examples cited in section 6
- [ ] All edge cases (section 11) are handled
- [ ] No unauthorized dependencies were added
- [ ] No blocked decisions were changed (section 10)
- [ ] Run: `npm run build` without errors
- [ ] No temporary logs or debugging code remain
- [ ] No unjustified TODOs remain
- [ ] Backward compatibility: `npx ai-code-reviewer review-file <file>` continues to work without `--provider`
- [ ] The Action works with `uses: giolabs/ai-code-reviewer@v1` in a test workflow
