---
title: Troubleshooting
description: Common issues and fixes for ai-code-reviewer.
---

## Workflow doesn't trigger on PRs

**Symptom:** You open a PR and the Action never starts.

**Cause:** The workflow is configured for `push` instead of `pull_request`, or the PR is a draft.

**Fix:** Confirm the workflow trigger:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
```

Draft PRs are excluded by the `if: github.event.pull_request.draft == false` condition in the job. Convert the PR to "Ready for review" to trigger the workflow.

---

## `Error: OPENAI_API_KEY is not set`

**Symptom:** The Action fails with a message about a missing API key.

**Cause:** The secret name in the workflow doesn't match what the CLI expects.

**Fix:** The correct secret names are:

| Provider | Secret name |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Gemini | `GEMINI_API_KEY` |

Double-check **Settings → Secrets and variables → Actions** in your repo. Common mistake: `OPENAI_KEY` instead of `OPENAI_API_KEY`.

Also confirm the secret is passed in the workflow `env:` block:

```yaml
env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## `Error: Resource not accessible by integration`

**Symptom:** The CLI runs but fails when trying to post the review to the PR.

**Cause:** The workflow is missing the required permissions.

**Fix:** Add the `permissions` block to your job:

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
```

Without `pull-requests: write`, the CLI can read the PR but cannot post comments.

---

## Review only covers part of the PR

**Symptom:** Large PRs get a partial review — some files are mentioned, others are ignored.

**Cause:** The total diff exceeds 80,000 characters and is truncated. Large individual files may also be skipped due to `maxFileSize`.

**Fix:** Reduce the scope of what gets reviewed:

```yaml
# .ai-review.yml
maxFileSize: 50000   # skip files with patches larger than 50 KB
ignore:
  - "**/*.snap"
  - "prisma/migrations/**"
  - "*.generated.ts"
```

The best long-term fix is smaller, more focused PRs.

---

## Ollama connection refused

**Symptom:** When using `provider: ollama`, the review fails with a connection error.

**Cause:** The Ollama service isn't running or the `ollamaUrl` is wrong.

**Fix:** Verify the service is running:

```bash
curl http://localhost:11434/api/tags
```

If the URL is different, set it in your config:

```yaml
# .ai-review.yml
provider: ollama
model: codellama
ollamaUrl: http://your-ollama-host:11434
```

In GitHub Actions, Ollama must be running as a service container in the same job or reachable via a network URL. Running Ollama on a self-hosted runner is the typical setup.

---

## Exit code 1 is blocking merges

**Symptom:** The reviewer returns exit code `1` and a branch protection rule is blocking the merge.

**Cause:** This is expected behavior. Exit code `1` means the recommendation is `request_changes`. The reviewer found significant issues.

**Fix (option A):** Address the findings and push new commits. The next PR update triggers a new review.

**Fix (option B):** If you want the check to be advisory only (never block), configure the branch protection rule to not require the reviewer check to pass, or change the `minSeverity` to a higher threshold:

```yaml
# .ai-review.yml
minSeverity: critical   # only block on critical findings
```
