---
title: Providers
description: Configure OpenAI, Anthropic, Gemini, or Ollama as the LLM provider for your code reviews.
---

The reviewer supports four LLM providers. Configure your preferred one in `.ai-review.yml`:

```yaml
provider: openai   # openai | anthropic | gemini | ollama
model: gpt-4o-mini # provider-specific model name
```

## Provider comparison

| Provider | GitHub Secret | Default model | Console |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com) |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | [console.anthropic.com](https://console.anthropic.com) |
| Gemini | `GEMINI_API_KEY` | `gemini-1.5-flash` | [aistudio.google.com](https://aistudio.google.com) |
| Ollama | *(no key — self-hosted)* | set via `model:` | [ollama.com](https://ollama.com) |

## OpenAI

Default provider. Uses `response_format: json_schema` for structured output — the model is constrained to valid JSON matching the review schema with no post-processing needed.

```yaml
# .ai-review.yml
provider: openai
model: gpt-4o-mini   # or gpt-4o for higher quality
```

```yaml
# GitHub Actions workflow
- run: npx -y ai-code-reviewer@latest review-pr
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Anthropic

Uses explicit JSON formatting instructions appended to the system prompt.

```yaml
# .ai-review.yml
provider: anthropic
model: claude-sonnet-4-20250514
```

```yaml
# GitHub Actions workflow
- run: npx -y ai-code-reviewer@latest review-pr
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Gemini

Uses explicit JSON formatting instructions appended to the system prompt.

```yaml
# .ai-review.yml
provider: gemini
model: gemini-1.5-flash   # or gemini-1.5-pro for higher quality
```

```yaml
# GitHub Actions workflow
- run: npx -y ai-code-reviewer@latest review-pr
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Ollama (self-hosted)

Ollama runs locally and requires no API key, but the service must be running and reachable from the environment where the reviewer runs.

```yaml
# .ai-review.yml
provider: ollama
model: codellama          # or any model you have pulled
ollamaUrl: http://localhost:11434   # default if omitted
```

For GitHub Actions, Ollama must be running as a service in the job or reachable via a network URL. For local use, just start `ollama serve` before running the reviewer.

:::tip
For most teams, **OpenAI `gpt-4o-mini`** is the best starting point — good quality, low cost, and structured output guarantees.
:::
