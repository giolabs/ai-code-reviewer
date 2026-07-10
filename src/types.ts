/**
 * Severity levels for a review finding.
 */
export type Severity = 'critical' | 'major' | 'minor' | 'info' | 'nitpick';

/**
 * Check categories the reviewer can run.
 */
export type CheckCategory =
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'testing'
  | 'documentation'
  | 'style'
  | 'bug-risk'
  | 'architecture';

/**
 * Tech stacks with built-in rule templates.
 */
export type TechStack =
  | 'nestjs'
  | 'react'
  | 'nextjs'
  | 'typescript'
  | 'node'
  | 'flutter'
  | 'laravel'
  | 'generic';

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama';

/**
 * Configuration loaded from `.ai-review.yml` or `.ai-review.json`.
 */
export interface ReviewerConfig {
  /** LLM provider (default: openai) */
  provider: ProviderName;
  /** Provider model. Backward-compatible alias; providerModel takes precedence */
  model: string;
  /** Provider model (takes precedence over model) */
  providerModel?: string;
  /** Ollama URL (only for ollama provider) */
  ollamaUrl?: string;
  /** Review language (default: es) */
  language: 'es' | 'en';
  /** Path to the custom rules file (markdown) */
  rules?: string;
  /** Forced tech stack. Auto-detected if not specified. */
  tech?: TechStack;
  /** Globs/paths to ignore */
  ignore: string[];
  /** Minimum severity to report (default: minor) */
  minSeverity: Severity;
  /** Maximum file size to review in bytes (default: 100000) */
  maxFileSize: number;
  /** Enabled check categories */
  checks: Record<CheckCategory, boolean>;
  /** Post as inline comments on the PR (default: true) */
  inlineComments: boolean;
  /** Post a general summary on the PR (default: true) */
  summaryComment: boolean;
  /** Maximum number of inline comments to post (default: 20) */
  maxInlineComments: number;
  /** Extra prompt to customize the review */
  customInstructions?: string;
  /** Inline comment feedback feature (opt-in) */
  feedback?: FeedbackConfig;
  /** Auto-approve when model recommends approve with no blocking findings (opt-in) */
  autoApprove?: AutoApproveConfig;
  /**
   * Subdirectory (relative to repo root) where the app's package.json lives.
   * Use this in monorepos where the app is not at the repository root.
   * Affects tech detection and dependency graph analysis.
   * Example: `appDir: site/app`
   */
  appDir?: string;
}

/**
 * An individual review finding (a comment on the code).
 */
export interface ReviewFinding {
  /** Relative path to the file */
  file: string;
  /** Affected line (in the new content) */
  line: number;
  /** Severity */
  severity: Severity;
  /** Category */
  category: CheckCategory;
  /** Short issue title */
  title: string;
  /** Detailed description with context and reasoning */
  description: string;
  /** Fix suggestion (optional, markdown/code block format) */
  suggestion?: string;
}

/**
 * A predicted regression risk: a caller of the changed code that may break.
 */
export interface RegressionRisk {
  /** Relative path of the caller file */
  file: string;
  /** Symbol (function, class, export) in the caller that is at risk */
  symbol: string;
  /** Reason why this caller may break */
  reason: string;
}

/**
 * Complete result of a review over one or more files.
 */
export interface ReviewResult {
  /** Executive summary in natural language */
  summary: string;
  /** List of findings */
  findings: ReviewFinding[];
  /** Overall PR score from 0 to 10 */
  overallScore?: number;
  /** Recommendation */
  recommendation: 'approve' | 'comment' | 'request_changes';
  /** Bugs not yet present but likely to surface given these changes */
  anticipatedBugs?: ReviewFinding[];
  /** Callers or consumers of the changed code that may break */
  regressionRisks?: RegressionRisk[];
  /** Tokens used (for cost tracking) */
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Represents a changed file in a PR/diff.
 */
export interface ChangedFile {
  /** Relative path */
  path: string;
  /** Change status */
  status: 'added' | 'modified' | 'removed' | 'renamed';
  /** Unified diff of the file (with @@ headers) */
  patch?: string;
  /** Full file content after the change (if reasonable to load) */
  content?: string;
  /** Added lines */
  additions: number;
  /** Removed lines */
  deletions: number;
}

// ---------------------------------------------------------------------------
// Feedback feature types
// ---------------------------------------------------------------------------

export enum FindingStatus {
  Open = 'open',
  Dismissed = 'dismissed',
  Resolved = 'resolved',
}

export enum SlashCommand {
  Explain = 'explain',
  Dismiss = 'dismiss',
  Unknown = 'unknown',
}

export interface FindingMetadata {
  id: string;
  file: string;
  line: number;
  /** Uses the existing Severity type alias — not promoted to enum */
  severity: Severity;
  status: FindingStatus;
  dismissedBy: string | null;
  /** REST comment ID of the AI's inline comment */
  commentId: number;
  /** GraphQL node ID of the review thread (for resolveReviewThread mutation) */
  threadNodeId: string;
}

export interface FeedbackConfig {
  enabled: boolean;
  allowDismiss: boolean;
}

export interface AutoApproveConfig {
  enabled: boolean;
  /** Minimum overallScore (0–10) required to auto-approve. Ignored when score is absent. */
  minScore: number;
}

export interface FeedbackEvent {
  /** GitHub login of the person who replied */
  actor: string;
  /** ID of the reply comment (the one containing the slash command) */
  commentId: number;
  commentBody: string;
  /** ID of the parent AI inline comment (from event.comment.in_reply_to_id); null if top-level */
  inReplyToId: number | null;
  pullNumber: number;
  repo: string;
  owner: string;
}

export interface ResolveFixedOptions {
  pullNumber: number;
  owner: string;
  repo: string;
  newFindings: ReadonlyArray<ReviewFinding>;
  /** Files changed in this push — only threads on these files are checked */
  changedFiles: ReadonlyArray<string>;
  commitSha: string;
  summaryCommentId: number;
}

export interface ExplainPromptOptions {
  findingMessage: string;
  filePath: string;
  line: number;
  severity: Severity;
  codeContext: string;
  language: 'es' | 'en';
}

/**
 * PR context for posting reviews.
 */
export interface PullRequestContext {
  owner: string;
  repo: string;
  pullNumber: number;
  /** SHA of the PR's latest commit (for inline comments) */
  headSha: string;
  /** Base branch SHA */
  baseSha: string;
  /** PR title */
  title: string;
  /** PR body */
  body: string | null;
}
