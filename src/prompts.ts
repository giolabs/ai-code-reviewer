import type { ChangedFile, ReviewerConfig, TechStack, PriorFinding, FeedbackEvaluationPromptArgs } from './types.js';
import { TechDetector } from './tech-detect.js';

interface ExplainPromptArgs {
  findingTitle: string;
  findingDescription: string;
  findingFile: string;
  findingLine: number;
  fileWindow: string;
  language: 'es' | 'en';
}

interface SystemPromptArgs {
  config: ReviewerConfig;
  tech: TechStack;
  mergedRulesText: string;
  dependencyIndex?: string;
  /** Project-authority digest (CLAUDE.md + docs/) — Axis 7. */
  projectDigest?: string;
  /** Official stack docs snippets for libraries touched by the diff — Axis 8. */
  officialDocs?: string;
}

interface UserPromptArgs {
  files: ReadonlyArray<ChangedFile>;
  prTitle?: string;
  prBody?: string | null;
  maxTotalChars?: number;
}

interface IncrementalUserPromptArgs {
  files: ReadonlyArray<ChangedFile>;
  priorFindings: ReadonlyArray<PriorFinding>;
  prTitle?: string;
  maxTotalChars?: number;
}

export class PromptBuilder {
  buildSystemPrompt(args: SystemPromptArgs): string {
    const { config, tech, mergedRulesText } = args;

    const enabledChecks = Object.entries(config.checks)
      .filter(([, on]) => on)
      .map(([k]) => k)
      .join(', ');

    const langInstruction =
      config.language === 'es'
        ? 'Respondé SIEMPRE en español rioplatense, claro y profesional.'
        : 'Always respond in clear, professional English.';

    const sections = [
      `You are a Senior Staff Engineer specializing in code review. Your goal is to review code changes with the rigor of an experienced reviewer: detect real bugs, security risks, performance issues, and maintainability problems. You are NOT a linter — do not flag trivial things that a linter or formatter would fix automatically.`,

      `**Project stack:** ${TechDetector.displayName(tech)}`,

      `**Enabled check categories:** ${enabledChecks}
Ignore disabled categories. If a check is off, do NOT generate findings for that category even if you spot them.`,

      `**Minimum severity to report:** ${config.minSeverity}
Scale (highest to lowest): critical > major > minor > info > nitpick.
- critical: bug that breaks production, exploitable vulnerability, data loss.
- major: likely bug, security issue without a direct exploit, serious performance problem.
- minor: relevant code smell, unhandled edge case, missing error handling.
- info: useful observation, optional improvement.
- nitpick: style, naming, micro-optimization.
Do NOT report findings below the minimum severity.`,

      `**Review rules (merged: project > global):**
${mergedRulesText || '(no rules — apply general best practices)'}`,
    ];

    if (args.projectDigest) {
      sections.push(this.buildProjectAuthoritySection(args.projectDigest));
    }

    if (args.officialDocs) {
      sections.push(
        `**Official stack documentation (version-specific, for the libraries touched by this diff):**\n${args.officialDocs}\n\nUse this to judge correct API usage. If the code contradicts this documentation, that is a valid finding.`,
      );
    }

    sections.push(this.buildDetectionChecklist());

    if (args.dependencyIndex) {
      sections.push(args.dependencyIndex);
      sections.push(
        `**How to use the dependency context above:**
- \`findings\`: issues that already exist in the diff (real bugs, code smells, security issues visible in the changed lines).
- \`anticipatedBugs\`: bugs that DO NOT exist yet but are likely to be introduced by this change — think about what could go wrong at runtime given the logic change.
- \`regressionRisks\`: for each caller listed in "Importers" above, reason about whether this change could break that caller. Return one entry per caller at risk. If the caller is safe, omit it.
Both \`anticipatedBugs\` and \`regressionRisks\` can be empty arrays if the change is safe.`,
      );
    }

    if (config.customInstructions) {
      sections.push(`**Additional user instructions:**\n${config.customInstructions}`);
    }

    sections.push(
      `**How to reference lines:**
- The \`line\` field must be the line number in the NEW file (right side of the diff).
- Only reference lines that are in the diff (lines starting with + in the patch, or immediate context). Inline comments only work there.
- If the issue is about the file in general (not a specific line), use the first changed line of the file and clarify it in the description.`,

      this.buildOutputRequirements(),

      `**Quality over quantity:**
- If the PR looks good, say so explicitly in the summary and return few findings (or zero).
- Do not invent problems to "fill" the review.
- Every finding must have a concrete rationale, not vague statements like "could be improved".
- A finding must be verifiable using ONLY the diff plus the context provided. Do not infer defects in code you cannot see.

${langInstruction}`,
    );

    return sections.join('\n\n');
  }

  private buildProjectAuthoritySection(projectDigest: string): string {
    return [
      `**Project rules & architecture (HIGHEST AUTHORITY — above the generic stack rules):**`,
      projectDigest,
      `How to use this: a finding that contradicts these documents is INVALID and must not be reported. A finding that flags a violation of these documents is HIGH priority. Respect deliberate project conventions (they are not bugs).`,
    ].join('\n\n');
  }

  private buildDetectionChecklist(): string {
    return [
      `**Detection checklist — reason explicitly through each axis before finalizing findings:**`,
      `- Regression: for each importer/caller in the dependency context, reason whether a changed signature, return contract, or side effect could break it.`,
      `- Silent failures: empty \`catch\`, swallowed errors, un-awaited promises, defaults that hide failures, \`?.\` masking an unexpected null, ignored return values.`,
      `- Technical debt: duplication, tight coupling, and workarounds marked as temporary (report as \`info\`/\`minor\`, category \`maintainability\`).`,
      `- Domain violations: business logic in the wrong layer, broken invariants, contradictions with the project rules above (category \`architecture\` or \`bug-risk\`).`,
      `- Architecture patterns: layer-boundary violations (e.g. controller→service→repository), broken dependency inversion, inconsistency with the surrounding module's established pattern (category \`architecture\`).`,
    ].join('\n');
  }

  private buildOutputRequirements(): string {
    return [
      `**Output requirements per finding:**`,
      `- \`codeRef\`: paste the exact code snippet (from the new side of the diff) the finding refers to. This anchors the finding so it is not duplicated when lines move.`,
      `- \`confidence\`: your confidence that the finding is real, from 0 (guess) to 1 (certain). Be honest; low confidence is fine for exploratory notes.`,
      `- \`suggestion\`: for every finding of severity \`major\` or \`critical\`, provide a concrete fix as a code block. When the fix applies to a single contiguous line range, format it as a GitHub \`suggestion\` block.`,
    ].join('\n');
  }

  /**
   * Builds the user prompt with the content to review. Truncates large diffs
   * to avoid blowing the context window.
   */
  buildUserPrompt(args: UserPromptArgs): string {
    const { files, prTitle, prBody, maxTotalChars = 80_000 } = args;

    const parts: string[] = [];

    if (prTitle) {
      parts.push(`**PR title:** ${prTitle}`);
    }
    if (prBody) {
      parts.push(`**PR description:**\n${prBody}`);
    }

    parts.push(`**Changed files (${files.length}):**`);

    let totalChars = parts.join('\n\n').length;
    const fileChunks: string[] = [];

    for (const file of files) {
      if (!file.patch) {
        fileChunks.push(`### ${file.path} (${file.status}, no patch available)`);
        continue;
      }

      const header = `### ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`;
      let chunk = `${header}\n\`\`\`diff\n${file.patch}\n\`\`\``;

      // Include the full post-change file when provided and within budget, so
      // silent failures outside the diff (e.g. a swallowed error above) are visible.
      if (file.content) {
        const fullBlock = `\n_Full file (post-change) for context:_\n\`\`\`\n${file.content}\n\`\`\``;
        if (totalChars + chunk.length + fullBlock.length <= maxTotalChars) {
          chunk += fullBlock;
        }
      }

      if (totalChars + chunk.length > maxTotalChars) {
        fileChunks.push(
          `### ${file.path} (${file.status})\n_[Diff truncated — exceeded the maximum prompt size.]_`,
        );
        totalChars += 120;
      } else {
        fileChunks.push(chunk);
        totalChars += chunk.length;
      }
    }

    parts.push(fileChunks.join('\n\n'));
    parts.push(
      `\nReview the changes following the rules and instructions in the system prompt. Return the response in the required JSON format.`,
    );

    return parts.join('\n\n');
  }

  buildIncrementalSystemPrompt(args: SystemPromptArgs): string {
    const { config, tech, mergedRulesText } = args;

    const enabledChecks = Object.entries(config.checks)
      .filter(([, on]) => on)
      .map(([k]) => k)
      .join(', ');

    const langInstruction =
      config.language === 'es'
        ? 'Respondé SIEMPRE en español rioplatense, claro y profesional.'
        : 'Always respond in clear, professional English.';

    const sections = [
      `You are performing an INCREMENTAL, VERIFY-ONLY re-review of a pull request. The full review already happened on the first run. Your ONLY job now is:
1. Report NEW bugs of severity \`critical\` or \`major\` that THIS push introduced in the changed lines.
2. Nothing else. Do NOT report new \`minor\`, \`info\`, \`nitpick\`, or style observations. Do NOT re-discover pre-existing issues. Do NOT re-report the prior findings (they are already tracked). If the push only adds clean code, return an empty findings array.`,

      `**Project stack:** ${TechDetector.displayName(tech)}`,

      `**Enabled check categories:** ${enabledChecks}
Ignore disabled categories. If a check is off, do NOT generate findings for that category even if you spot them.`,

      `**Minimum severity to report:** ${config.minSeverity}
Scale (highest to lowest): critical > major > minor > info > nitpick.
- critical: bug that breaks production, exploitable vulnerability, data loss.
- major: likely bug, security issue without a direct exploit, serious performance problem.
- minor: relevant code smell, unhandled edge case, missing error handling.
- info: useful observation, optional improvement.
- nitpick: style, naming, micro-optimization.
Do NOT report findings below the minimum severity.`,

      `**Review rules (merged: project > global):**
${mergedRulesText || '(no rules — apply general best practices)'}`,
    ];

    if (args.projectDigest) {
      sections.push(this.buildProjectAuthoritySection(args.projectDigest));
    }

    if (args.dependencyIndex) {
      sections.push(args.dependencyIndex);
    }

    if (config.customInstructions) {
      sections.push(`**Additional user instructions:**\n${config.customInstructions}`);
    }

    sections.push(
      `**How to reference lines:**
- The \`line\` field must be the line number in the NEW file (right side of the diff).
- Only reference lines that are in the diff (lines starting with + in the patch, or immediate context). Inline comments only work there.
- If the issue is about the file in general (not a specific line), use the first changed line of the file and clarify it in the description.`,

      this.buildOutputRequirements(),

      `**Quality over quantity:**
- If the new push looks clean with respect to prior findings and general quality, return an empty findings array and set recommendation to 'comment'.
- Every finding must have a concrete rationale, not vague statements like "could be improved".

${langInstruction}`,
    );

    return sections.join('\n\n');
  }

  buildIncrementalUserPrompt(args: IncrementalUserPromptArgs): string {
    const { files, priorFindings, prTitle, maxTotalChars = 80_000 } = args;

    const parts: string[] = [];

    if (prTitle) {
      parts.push(`**PR title:** ${prTitle}`);
    }

    parts.push(`**Prior open findings from previous review (${priorFindings.length}):**`);
    if (priorFindings.length === 0) {
      parts.push('_(none)_');
    } else {
      priorFindings.forEach((f, i) => {
        const desc = f.description.slice(0, 300).replace(/\n/g, ' ');
        parts.push(
          `${i + 1}. [${f.severity.toUpperCase()}] \`${f.file}:${f.line}\` — ${f.title}\n   ${desc}`,
        );
      });
    }

    parts.push(`**New changes in this push (${files.length} file(s)):**`);

    let totalChars = parts.join('\n\n').length;
    const fileChunks: string[] = [];

    for (const file of files) {
      if (!file.patch) {
        fileChunks.push(`### ${file.path} (${file.status}, no patch available)`);
        continue;
      }

      const header = `### ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`;
      const chunk = `${header}\n\`\`\`diff\n${file.patch}\n\`\`\``;

      if (totalChars + chunk.length > maxTotalChars) {
        fileChunks.push(
          `### ${file.path} (${file.status})\n_[Diff truncated — exceeded the maximum prompt size.]_`,
        );
        totalChars += 120;
      } else {
        fileChunks.push(chunk);
        totalChars += chunk.length;
      }
    }

    parts.push(fileChunks.join('\n\n'));
    parts.push(
      `Review only the new changes. Flag regressions or new critical/major issues specifically related to the prior findings above. If the new changes partially or fully address a prior finding, do NOT re-flag it. Return the response in the required JSON format.`,
    );

    return parts.join('\n\n');
  }

  buildFeedbackEvaluationPrompt(args: FeedbackEvaluationPromptArgs): string {
    const { findingTitle, findingDescription, findingSeverity, findingFile, findingLine, devReply, fileWindow, language } = args;

    const langInstruction =
      language === 'es'
        ? 'Respondé SIEMPRE en español rioplatense, claro y respetuoso.'
        : 'Always respond in clear, respectful English.';

    const jsonInstruction =
      language === 'es'
        ? 'Devolvé ÚNICAMENTE un objeto JSON con la estructura exacta: {"decision": "resolved" | "maintained", "reply": "<tu respuesta al hilo>"}'
        : 'Return ONLY a JSON object with the exact structure: {"decision": "resolved" | "maintained", "reply": "<your thread reply>"}';

    return [
      `You are a Senior Staff Engineer reviewing whether a code review finding is still valid after the developer replied.`,
      ``,
      `**Finding:**`,
      `- File: \`${findingFile}\` (line ${findingLine})`,
      `- Severity: ${findingSeverity}`,
      `- Title: ${findingTitle}`,
      `- Description: ${findingDescription}`,
      ``,
      `**Developer's reply:**`,
      devReply,
      ``,
      `**Current file state around line ${findingLine}:**`,
      `\`\`\``,
      fileWindow,
      `\`\`\``,
      ``,
      `Evaluate against the CURRENT file state versus the ORIGINAL problem — not against the exact fix you originally suggested. Be generous, not strict:`,
      `- If the change reasonably addresses the concern — even if solved differently than suggested — set decision to "resolved".`,
      `- Only set "maintained" when the original problem is CLEARLY still present and exploitable.`,
      `- When in doubt, set "resolved" and explain briefly. Do not re-litigate style once the substance is handled.`,
      `Write a short, respectful reply (2-4 sentences) to post in the thread explaining your decision.`,
      langInstruction,
      jsonInstruction,
    ].join('\n');
  }

  buildExplainPrompt(args: ExplainPromptArgs): string {
    const { findingTitle, findingDescription, findingFile, findingLine, fileWindow, language } = args;

    const langInstruction =
      language === 'es'
        ? 'Respondé en español rioplatense, claro y didáctico. Devolvé SOLO texto markdown (sin JSON).'
        : 'Answer in clear, didactic English. Return ONLY markdown text (no JSON).';

    return [
      `You are a Senior Staff Engineer. A developer asked for a fuller explanation of a code review finding.`,
      ``,
      `**Finding:**`,
      `- File: \`${findingFile}\` (line ${findingLine})`,
      `- Title: ${findingTitle}`,
      `- Description: ${findingDescription}`,
      ``,
      `**Current file state around line ${findingLine}:**`,
      `\`\`\``,
      fileWindow,
      `\`\`\``,
      ``,
      `Explain why this matters, the concrete failure scenario it can cause, and a concrete fix (with a short code snippet when useful). Be practical and specific to the code shown.`,
      langInstruction,
    ].join('\n');
  }

}
