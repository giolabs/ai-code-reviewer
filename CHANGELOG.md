# Changelog

All notable changes to this project will be documented in this file.

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
