---
title: Design Decisions
description: Architectural rationale behind ai-code-reviewer.
---

## Why a CLI that runs in Actions, not a GitHub App?

GitHub Apps require your own infrastructure: a server to receive webhooks, a token rotation mechanism, and a deployment to keep running. A CLI via `npx` runs on the GitHub Actions runner owned by the user's repo — no infrastructure to maintain, no availability to manage, and the bot's code is fully auditable by the team using it.

The trade-off: the reviewer doesn't have persistent state between PRs. Each review is independent. For most code review use cases, this is fine.

## Why multi-provider?

Different teams have different contracts, privacy preferences, and budgets. OpenAI is the default because it has the best quality-to-cost ratio for code review today and offers `response_format: json_schema` for guaranteed structured output — but Anthropic, Gemini, and Ollama are valid alternatives.

The CLI abstracts the provider behind a common interface. Switching providers is a field in `.ai-review.yml` and a secret in the repo — no workflow changes needed.

## Why never auto-approve?

Even if the model returns `approve` in its recommendation, the review is posted as `COMMENT` or `REQUEST_CHANGES`. Approving PRs remains a human decision.

The model can miss context: it doesn't know the business intent, the deployment environment, or conversations that happened outside the code. Auto-approval would give users a false sense of security. The reviewer is a tool to assist humans, not replace them.

## Why inline comments + summary, not just one big comment?

Inline comments appear at the relevant spot in the diff, which significantly reduces the friction of understanding what the reviewer is flagging. A finding on line 47 of `users.service.ts` is immediately actionable — the developer sees it while looking at the code.

The summary covers two categories that can't be inlined:

1. **Findings on lines outside the diff** — GitHub only allows commenting on changed lines
2. **Anticipated bugs and regression risks** — cross-file concerns that don't map to a single changed line
