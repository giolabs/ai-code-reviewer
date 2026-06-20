import type { ChangedFile, ReviewerConfig, TechStack } from './types.js';
import { TechDetector } from './tech-detect.js';

interface SystemPromptArgs {
  config: ReviewerConfig;
  tech: TechStack;
  mergedRulesText: string;
}

interface UserPromptArgs {
  files: ReadonlyArray<ChangedFile>;
  prTitle?: string;
  prBody?: string | null;
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

    if (config.customInstructions) {
      sections.push(`**Additional user instructions:**\n${config.customInstructions}`);
    }

    sections.push(
      `**How to reference lines:**
- The \`line\` field must be the line number in the NEW file (right side of the diff).
- Only reference lines that are in the diff (lines starting with + in the patch, or immediate context). Inline comments only work there.
- If the issue is about the file in general (not a specific line), use the first changed line of the file and clarify it in the description.`,

      `**Quality over quantity:**
- If the PR looks good, say so explicitly in the summary and return few findings (or zero).
- Do not invent problems to "fill" the review.
- Every finding must have a concrete rationale, not vague statements like "could be improved".

${langInstruction}`,
    );

    return sections.join('\n\n');
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
      `\nReview the changes following the rules and instructions in the system prompt. Return the response in the required JSON format.`,
    );

    return parts.join('\n\n');
  }
}
