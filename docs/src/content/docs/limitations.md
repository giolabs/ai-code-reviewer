---
title: Known Limitations
description: Current limitations of ai-code-reviewer and workarounds.
---

## Only `pull_request` / `pull_request_target` events

The reviewer is designed to run on PR events. Direct `push` to a branch is not supported. For reviewing changes outside of a PR, use [`review-diff`](./cli-reference#review-diff) locally.

## Giant diffs are truncated

PRs with thousands of changed lines may not fit in the LLM's context window. When the total diff exceeds 80,000 characters, it is truncated and the model only sees part of the changes.

**Workaround:** Aim for smaller PRs. You can also increase `minSeverity` to `major` and reduce `maxFileSize` to limit the volume of content sent to the model.

## Inline comments only on diff lines

GitHub's API does not allow posting comments on lines that weren't changed in the PR. Findings about code outside the diff (e.g., a caller that may break) are added to the PR summary body instead.

## No memory between PRs

Each review is completely independent. The reviewer has no knowledge of previous reviews, past findings, or earlier conversations about the code. It sees only the current diff and its context.

## Dependency graph requires JS/TS

The 1-level dependency graph feature (used to detect regression risks and anticipated bugs) only works for JavaScript and TypeScript stacks. It relies on `madge` for static analysis. Flutter, Laravel, and Generic stacks receive the review without graph context.

## `madge` may time out on large repos

On repositories with thousands of modules, `madge` can take more than 10 seconds to build the dependency graph. The reviewer imposes a 10-second timeout — if `madge` exceeds it, the graph is skipped silently and the review proceeds without it.
