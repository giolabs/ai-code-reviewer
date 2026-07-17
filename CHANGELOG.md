# Changelog

All notable changes to this project will be documented in this file.

## [v0.1.0-beta.18] – 2026-07-17

### Features
- `@botai approved` now dismisses the bot's prior `CHANGES_REQUESTED` reviews before submitting `APPROVE`, and suppresses open finding fingerprints (marking them dismissed / resolving threads) so false positives that blocked the PR do not reappear on the next push. APPROVE failures are reported back in the PR thread instead of failing silently.

## [v0.1.0-beta.17] – 2026-07-17

### Features
- false-positive reduction from production evidence (flowstore PR #76 corpus): Actionable finding gate in system prompts, expanded "What is NOT a finding" rules, `FindingVerifier` now receives the project authority digest and refutes already-present / scope-creep / intentional-ADR / non-hermetic-CI / future-ops findings, diff-ranked ADR/docs digest before truncation, and budgeted sibling test + infra README context in the user prompt.

### Bug Fixes
- `docs/adr/**/*.md` globs now match files directly under `docs/adr/` (`**` can match zero path segments), so ADRs are included in the project knowledge digest.

## [v0.1.0-beta.16] – 2026-07-15

### Features
- persistent cross-PR Learnings (opt-in, `learnings.enabled`): rules captured via `@botai learn """rule"""` or auto-captured from `@botai dismiss` are committed to `.ai-review-learnings.md` on the PR's base branch and injected into every future review of that branch — previously `suppressedFingerprints`/dismiss state was scoped to one PR, so a false positive dismissed in one PR would be flagged fresh again in the next. Requires `contents: write` in addition to `pull-requests: write`.
- `@botai ask """question"""` general-purpose Q&A command, usable inline (answers using the surrounding code, no finding metadata required) and from a general PR comment (answers using the PR's AI Code Review summary). Never triggers a re-review.

## [v0.1.0-beta.15] – 2026-07-15

### Features
- orphan findings (unmappable to a diff line) are now tracked via an embedded marker in the summary comment and fed into incremental "prior open findings" — previously they had no metadata, so a PR whose only blocking finding was an orphan could never gate into incremental mode and every push re-ran a full review that could re-flag the exact same issue forever, with no `@botai dismiss` path.
- `@botai review` now works from a general PR comment, not just inline thread replies. It re-runs the full PR review, feeding the developer's explanation (quoted with `"""..."""` in the same comment, or gathered from earlier general comments since the bot's last review) into the model so it can recognize when a previously flagged concern is already addressed.

## [v0.1.0-beta.14] – 2026-07-15

### Features
- multi-stack review by directory: `appDir` accepts a list of subproject directories (e.g. a Flutter app + a NestJS backend in the same monorepo); each changed file is reviewed under its own directory's tech-specific rules (own LLM call per stack), and results merge into a single PR review — any major/critical finding in any subproject still forces `REQUEST_CHANGES` for the whole PR. New `maxStackGroups` config bounds the LLM call count. Backward compatible with the existing single-string `appDir`.

### Bug Fixes
- OpenAI reasoning models (`gpt-5*`, `o1*`, `o3*`, `o4*`) reject any explicit `temperature` value and returned `400 Unsupported value`; the adapter now omits `temperature` for those models instead of always sending `0.2`.

## [v0.1.0-beta.13] – 2026-07-15

### Bug Fixes
- single AI review summary per PR, forced block on major findings, fenced suggestions

### Other Changes
- english maturity page + full example config with new keys
