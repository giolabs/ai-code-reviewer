# SPEC BRIEF: Multi-LLM GitHub Action with Hierarchical Rules

## 1. Overview
Transform ai-code-reviewer from OpenAI-only CLI into a reusable GitHub Action supporting 4 LLM providers (OpenAI, Anthropic Claude, Google Gemini, Ollama) with project-level config merging into tech-stack templates.

---

## 2. Distribution Model
- **GitHub Action reusable** (uses: giolabs/ai-code-reviewer@v1)
- **Input**: action.yml params (model, provider, rules-path, language, etc.)
- **No webhook server**: CLI runs inside GitHub Actions runner (Linux)
- **Entry**: action.ts (new) calls cli.ts reviewPullRequest() with GitHub Actions context

---

## 3. LLM Provider Architecture

### 3.1 Adapter Interface
New file: `src/adapters/llm-adapter.ts`
```typescript
interface LLMAdapter {
  runReview(args: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<ReviewResult>;
}
```

### 3.2 Provider Implementations
- **src/adapters/openai-adapter.ts** — wraps openai.ts (existing)
- **src/adapters/anthropic-adapter.ts** — uses @anthropic-ai/sdk, messages API
- **src/adapters/gemini-adapter.ts** — uses @google/generative-ai
- **src/adapters/ollama-adapter.ts** — HTTP POST to local llama2/mistral with JSON parsing retry

### 3.3 Response Schema & Retry Logic
- All adapters must output JSON matching REVIEW_SCHEMA (from openai.ts)
- Providers without native `json_schema` (Anthropic, Gemini, Ollama):
  - Append JSON instruction: "Respond ONLY with valid JSON matching schema: {...}"
  - On parse failure (malformed JSON): retry 2x with prompt injection guard
  - Final fallback: parse as best-effort or error

### 3.4 Router (New)
File: `src/llm-router.ts`
```typescript
function createLLMAdapter(provider: 'openai' | 'anthropic' | 'gemini' | 'ollama', config: LLMConfig): LLMAdapter
```
- Reads provider from config.provider (default: 'openai')
- Reads API keys from env vars (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, OLLAMA_URL)
- Returns appropriate adapter instance

---

## 4. Config Schema Changes

### 4.1 types.ts Update
```typescript
interface ReviewerConfig {
  // existing fields...
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama'; // NEW, default: 'openai'
  model: string; // now provider-specific (gpt-4o-mini, claude-opus, gemini-2.0-pro, mistral)
  ollamaUrl?: string; // NEW, for Ollama (default: http://localhost:11434)
  // ... rest unchanged
}
```

### 4.2 .ai-review.yml / action.yml Inputs
```yaml
# .ai-review.yml
provider: anthropic
model: claude-opus
ollamaUrl: http://localhost:11434  # ignored unless provider: ollama
```

```yaml
# action.yml (NEW)
inputs:
  provider:
    description: 'LLM provider: openai, anthropic, gemini, ollama'
    default: 'openai'
  model:
    description: 'Model ID (gpt-4o-mini, claude-opus, gemini-2.0-pro, mistral, etc.)'
    default: 'gpt-4o-mini'
  ollama-url:
    description: 'Ollama base URL (only for provider: ollama)'
    default: 'http://localhost:11434'
  config-path:
    description: 'Path to .ai-review.yml (optional, searches by convention if not set)'
  language:
    description: 'Output language: es, en'
    default: 'es'
  # ... existing params (rules-path, tech, etc.)
```

---

## 5. Rules Hierarchy & Merging

### 5.1 Priority Order
1. **Project rules** (`.ai-review.yml` + `code-review-rules.md` in repo root)
2. **Global built-in** (`templates/<tech>-rules.md` in action repo)
3. **Fallback** (`templates/generic-rules.md`)

### 5.2 Merging Logic (Category-Level)
New file: `src/rules-merger.ts`
```typescript
interface RulesBlock {
  category: CheckCategory;
  rules: string[];
  severity: Severity; // default severity for category
}

function mergeRules(
  projectRules: string | null,     // from code-review-rules.md
  globalRules: string,              // from templates/<tech>-rules.md
  category?: CheckCategory           // optional filter
): string
```

- Parse both files as markdown, extract `## <category>` sections
- For each category in projectRules, override the entire section from globalRules
- Categories not in projectRules fall back to globalRules
- Append any custom instructions from config.customInstructions at end

Example:
```
global: security, performance, testing, bug-risk, architecture
project defines: security, performance only
result: project-security + project-performance + global-testing + global-bug-risk + global-architecture
```

### 5.3 System Prompt Integration
`src/prompts.ts` buildSystemPrompt() now:
1. Loads project config.rules file
2. Detects tech stack
3. Calls mergeRules() to blend project + global
4. Inserts merged rules into system prompt sections

---

## 6. File-by-File Changes

### 6.1 Modified Files
- **src/types.ts**: Add `provider`, `ollamaUrl` to ReviewerConfig
- **src/config.ts**: Load `provider`, `ollamaUrl`; update defaults
- **src/reviewer.ts**: Replace direct openai.ts call with LLM router; no logic change
- **src/prompts.ts**: Integrate rules-merger; add merged rules to system prompt
- **src/openai.ts**: Extract into openai-adapter.ts; keep openai.ts as thin wrapper for backward compat
- **package.json**: Add @anthropic-ai/sdk, @google/generative-ai, remove duplicate openai

### 6.2 New Files
- **src/adapters/llm-adapter.ts** — interface definition
- **src/adapters/openai-adapter.ts** — wrapper around openai.ts logic
- **src/adapters/anthropic-adapter.ts** — new Anthropic integration
- **src/adapters/gemini-adapter.ts** — new Google Gemini integration
- **src/adapters/ollama-adapter.ts** — new local LLM integration
- **src/llm-router.ts** — factory to select adapter by config.provider
- **src/rules-merger.ts** — parse & merge markdown rule files
- **src/action.ts** (NEW) — GitHub Actions entry point (wraps reviewer.ts)
- **action.yml** (NEW) — GitHub Action metadata

---

## 7. GitHub Action Integration

### 7.1 action.yml
```yaml
name: AI Code Reviewer
description: 'Multi-LLM code review for GitHub PRs'
inputs: [as in 5.2 above]
outputs:
  review-result: JSON stringified ReviewResult
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: 18
    - run: npm ci
      shell: bash
    - run: node dist/action.js
      shell: bash
```

### 7.2 src/action.ts (New)
```typescript
async function main() {
  const opts: ReviewerCliOptions = {
    configPath: process.env.INPUT_CONFIG_PATH,
    model: process.env.INPUT_MODEL,
    provider: process.env.INPUT_PROVIDER,
    // ... parse action inputs from env
  };
  await reviewPullRequest(opts);
}
```

### 7.3 Workflow Example (in docs)
```yaml
# .github/workflows/ai-review.yml
name: AI Code Review
on: pull_request
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: giolabs/ai-code-reviewer@v1
        with:
          provider: anthropic
          model: claude-opus
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

---

## 8. JSON Response Parsing

### 8.1 Schema Consistency
All adapters output:
```json
{
  "summary": "...",
  "overallScore": 8,
  "recommendation": "approve" | "comment" | "request_changes",
  "findings": [
    {
      "file": "src/foo.ts",
      "line": 42,
      "severity": "major",
      "category": "security",
      "title": "...",
      "description": "...",
      "suggestion": "..."
    }
  ]
}
```

### 8.2 Validation
New file: `src/schema.ts`
```typescript
function validateReviewResult(json: unknown): ReviewResult | null
```
- Uses JSON.parse() with fallback error handling
- Type-checks required fields
- Coerces types where safe (e.g., string severity → enum)

---

## 9. Environment & Secrets

### 9.1 API Key Detection
- OpenAI: OPENAI_API_KEY env var
- Anthropic: ANTHROPIC_API_KEY env var
- Gemini: GOOGLE_API_KEY env var
- Ollama: OLLAMA_URL env var (or config.ollamaUrl)

Each adapter's `requireApiKey()` throws if provider env var not found.

### 9.2 GitHub Token
Existing GITHUB_TOKEN flow unchanged (for PR context & posting comments).

---

## 10. Tech Stack Detection
`src/tech-detect.ts` unchanged (remains provider-agnostic).

---

## 11. Output & Posting
`src/output.ts` and `src/github.ts` unchanged — all work with ReviewResult regardless of provider.

---

## 12. Testing (Phase 2 — Out of Scope)
- Unit tests for each adapter (mock API responses)
- Integration test for rules-merger (parse fixtures)
- E2E test via GitHub Actions on test repo

---

## 13. Dependencies

### New Package Additions
```json
{
  "@anthropic-ai/sdk": "^0.28.0",
  "@google/generative-ai": "^0.21.0"
}
```
No new CLI dependencies (Ollama uses built-in fetch/http).

---

## 14. Backward Compatibility
- Default provider: 'openai' (existing behavior)
- Existing .ai-review.yml files work unchanged (provider optional)
- CLI commands unchanged; action.ts is new entry point

---

## 15. Ambiguities & Gaps

### Flagged Issues
1. **Gemini JSON mode**: Google's API doesn't guarantee strict JSON schema (unlike OpenAI). Fallback retry strategy required; error budget unknown.
2. **Ollama model selection**: How do users specify which local model? Via config.model field? Need docs/example.
3. **Token counting**: OpenAI reports usage; Anthropic & Gemini may not. How to track cost across providers?
4. **Rate limiting**: No backoff strategy defined; assumes each provider's SDK handles it.
5. **Multi-model fallback**: If provider endpoint times out, should action retry with different provider? Out of scope — fail fast for now.
6. **Rules file encoding**: Assume UTF-8. What if project has ISO-8859-1 code-review-rules.md?
7. **Action versioning**: How to publish to GitHub Marketplace? Separate PR for release workflow.

---

## 16. Deliverables Checklist
- [ ] src/adapters/{llm-adapter,openai-adapter,anthropic-adapter,gemini-adapter,ollama-adapter}.ts
- [ ] src/llm-router.ts
- [ ] src/rules-merger.ts
- [ ] src/schema.ts (validator)
- [ ] src/action.ts (GitHub Actions entry)
- [ ] action.yml (GitHub Action metadata)
- [ ] types.ts, config.ts updated
- [ ] prompts.ts updated (rules merge integration)
- [ ] reviewer.ts updated (router integration)
- [ ] package.json updated (dependencies)
- [ ] docs/MULTI_LLM.md (user guide)
- [ ] examples/workflows/anthropic.yml, gemini.yml, ollama.yml

---

## 17. Implementation Order
1. **Phase 1A**: Adapter interface + router (src/adapters/, llm-router.ts)
2. **Phase 1B**: Anthropic & Gemini adapters + retry logic
3. **Phase 1C**: Ollama adapter + local testing
4. **Phase 2**: Rules merger + prompts integration
5. **Phase 3**: GitHub Action wrapper (action.ts, action.yml)
6. **Phase 4**: Tests & docs

---

## 18. Time Estimate
- Adapters (1A–1C): 6–8 hours
- Rules merger & integration (2): 4–6 hours
- GitHub Action & publishing (3): 3–4 hours
- Tests & docs (4): 4–6 hours
- **Total**: ~20–24 hours

---

## 19. Success Criteria
- [ ] Single .ai-review.yml works with all 4 providers (change only `provider:` field)
- [ ] Rules merge verified: project rules override category-by-category
- [ ] GitHub Action runs in ubuntu-latest, posts review (test with Claude Opus)
- [ ] Ollama works locally (mistral 7b tested)
- [ ] JSON parsing robust: handles Anthropic/Gemini quirks gracefully
- [ ] Backward compatible: existing workflows still work

---

## 20. Future Work (Out of Scope)
- Multi-provider fallback (A/B test providers)
- Dashboard/metrics persistence (requires server)
- GitHub App webhook distribution (different architecture)
- Plugin system for custom adapters
- Caching LLM responses per file hash
- Claude's batch API integration (async)
