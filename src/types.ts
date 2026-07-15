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
  /** Adversarial self-critique pass over first-run findings (opt-in, on by default) */
  selfCritique?: SelfCritiqueConfig;
  /** Read CLAUDE.md + docs/ as project-grounding authority (opt-in, on by default) */
  projectContext?: ProjectContextConfig;
  /** Official stack docs grounding (opt-in, disabled by default) */
  officialDocs?: OfficialDocsConfig;
  /**
   * Subdirectory (relative to repo root) where a subproject's package.json/
   * pubspec.yaml/composer.json lives. Use this in monorepos where the app is
   * not at the repository root. Affects tech detection and dependency graph
   * analysis. Accepts a single directory or a list of directories when the
   * monorepo has multiple subprojects with independent stacks — each changed
   * file is reviewed with the rules of the configured directory that is its
   * longest matching path prefix; files outside every configured directory
   * fall back to the stack detected at the repo root.
   * Example: `appDir: site/app` or `appDir: [apps/web, apps/api]`
   */
  appDir?: string | ReadonlyArray<string>;
  /**
   * Maximum number of distinct tech-stack groups reviewed with their own LLM
   * call per PR. Extra groups (smallest by changed-file count) are folded
   * into the fallback/root group instead of growing the call count without
   * bound. Default 4.
   */
  maxStackGroups: number;
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
  /**
   * Exact code snippet the finding refers to (right side of the diff).
   * Used to build a position-independent fingerprint so a finding is not
   * re-reported when its line shifts or its title is reworded.
   */
  codeRef?: string;
  /** Model confidence that the finding is real, 0 (guess) to 1 (certain). */
  confidence?: number;
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

/**
 * A set of changed files that share the same detected tech stack, reviewed
 * together with one LLM call and that stack's own rules template.
 */
export interface StackGroup {
  /** Configured directory this group was assigned to (relative to repo root), or '.' for the fallback group */
  dir: string;
  /** Tech stack detected for `dir` */
  tech: TechStack;
  /** Absolute filesystem path used for tech detection / dependency graph analysis for this group */
  appCwd: string;
  /** Changed files assigned to this group (repo-root-relative paths) */
  files: ReadonlyArray<ChangedFile>;
}

// ---------------------------------------------------------------------------
// Feedback feature types
// ---------------------------------------------------------------------------

export enum FindingStatus {
  Open = 'open',
  Dismissed = 'dismissed',
  Resolved = 'resolved',
}

export type BotCommand = 'approved' | 'review' | 'resolved' | 'dismiss' | 'explain' | 'unknown';

export interface BotCommandParseResult {
  command: BotCommand;
  reviewText?: string;
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

/**
 * Adversarial verification pass configuration (Axis 4).
 * A second LLM call tries to refute each first-pass finding; non-survivors
 * and low-confidence low-severity findings are dropped before posting.
 */
export interface SelfCritiqueConfig {
  enabled: boolean;
  /** Findings below this confidence AND at/below `minor` severity are dropped (0–1). */
  confidenceThreshold: number;
}

/**
 * Project grounding configuration (Axis 7).
 * Reads CLAUDE.md and selected docs/ files as authority above generic rules.
 */
export interface ProjectContextConfig {
  /** Read root/nested CLAUDE.md files. */
  claudeMd: boolean;
  /** Globs (relative to repo root) of docs to include in the knowledge digest. */
  docsGlobs: string[];
  /** Maximum characters of the assembled digest injected into the prompt. */
  maxChars: number;
}

export type OfficialDocsProviderName = 'none' | 'context7';

/**
 * Official stack docs grounding configuration (Axis 8B).
 * Disabled by default; fail-open when the provider is unavailable.
 */
export interface OfficialDocsConfig {
  enabled: boolean;
  provider: OfficialDocsProviderName;
}

export type FeedbackEvaluationDecision = 'resolved' | 'maintained';

export interface FeedbackEvaluationResult {
  decision: FeedbackEvaluationDecision;
  reply: string;
}

export interface FeedbackEvaluationPromptArgs {
  findingTitle: string;
  findingDescription: string;
  findingSeverity: string;
  findingFile: string;
  findingLine: number;
  devReply: string;
  fileWindow: string;
  language: 'es' | 'en';
}

export interface FeedbackEvent {
  /** GitHub login of the person who replied */
  actor: string;
  /** ID of the reply comment (the one containing the @botai command) */
  commentId: number;
  commentBody: string;
  /** ID of the parent AI inline comment; null when the source is issue_comment or a top-level review comment */
  inReplyToId: number | null;
  pullNumber: number;
  repo: string;
  owner: string;
  /** SHA of the PR's HEAD commit at the time of the reply event */
  headSha?: string;
  /** Whether the event came from a PR review comment thread or a general PR comment */
  source: 'review_comment' | 'issue_comment';
}

/**
 * Result of handling one feedback event. When `triggerReview` is true, the
 * caller (the `handle-feedback` CLI command) re-runs the full PR review —
 * `FeedbackHandler` only interprets/replies to comments, it doesn't own the
 * review pipeline.
 */
export interface FeedbackHandleResult {
  triggerReview: boolean;
  /** Extra context (developer's clarifications) appended to the system prompt for the triggered review. */
  extraInstructions?: string;
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

/**
 * SHAs from a GitHub Actions `synchronize` event payload.
 * Used to fetch the incremental diff between the previous and current PR HEAD.
 */
export interface PushEventShas {
  before: string;
  after: string;
}

/**
 * Project context cached in a hidden PR comment after the first full review.
 * Used by subsequent reviews to skip TechDetector re-detection.
 */
export interface ProjectContext {
  /** Tech stack detected on first review (root/fallback stack when stackMap is present) */
  tech: TechStack;
  /** Value of config.appDir at detection time, or undefined if not set. Legacy single-dir form; superseded by stackMap. */
  appDir: string | undefined;
  /**
   * Per-directory tech stack detected on first review, one entry per
   * configured `appDir` directory. Absent for caches written before
   * multi-stack support existed (falls back to `tech`/`appDir`).
   */
  stackMap?: ReadonlyArray<{ dir: string; tech: TechStack }>;
  /** Reviewer package version that wrote this context */
  reviewerVersion: string;
  /** ISO 8601 timestamp of detection */
  detectedAt: string;
  /**
   * Fingerprints of findings the developer dismissed as false positives.
   * These are never re-posted on any later push (Axis 2).
   */
  suppressedFingerprints?: string[];
}

/**
 * A prior open finding from a previous bot review, used as context
 * for incremental re-review prompts.
 */
export interface PriorFinding {
  file: string;
  line: number;
  severity: string;
  title: string;
  description: string;
}
