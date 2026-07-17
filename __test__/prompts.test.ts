import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../src/prompts.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { ChangedFile, ReviewerConfig } from '../src/types.js';

function makeConfig(overrides: Partial<ReviewerConfig> = {}): ReviewerConfig {
  return { ...DEFAULT_CONFIG, ...overrides, checks: { ...DEFAULT_CONFIG.checks, ...overrides.checks } };
}

function makeFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: 'src/foo.ts',
    status: 'modified',
    additions: 5,
    deletions: 2,
    patch: '@@ -1,2 +1,5 @@\n+const x = 1;\n+const y = 2;',
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  describe('buildSystemPrompt', () => {
    it('should include Spanish instruction when language is es', () => {
      // Arrange
      const config = makeConfig({ language: 'es' });

      // Act
      const result = builder.buildSystemPrompt({ config, tech: 'typescript', mergedRulesText: '' });

      // Assert
      expect(result).toContain('español rioplatense');
    });

    it('should include English instruction when language is en', () => {
      // Arrange
      const config = makeConfig({ language: 'en' });

      // Act
      const result = builder.buildSystemPrompt({ config, tech: 'typescript', mergedRulesText: '' });

      // Assert
      expect(result).toContain('Always respond in clear, professional English');
    });

    it('should include customInstructions when provided', () => {
      // Arrange
      const config = makeConfig({ customInstructions: 'Focus on security above all else.' });

      // Act
      const result = builder.buildSystemPrompt({ config, tech: 'node', mergedRulesText: '' });

      // Assert
      expect(result).toContain('Focus on security above all else.');
    });

    it('should NOT include customInstructions section when not provided', () => {
      // Arrange
      const config = makeConfig();

      // Act
      const result = builder.buildSystemPrompt({ config, tech: 'node', mergedRulesText: '' });

      // Assert
      expect(result).not.toContain('Additional user instructions');
    });

    it('should only include enabled check categories in the enabled checks line', () => {
      // Arrange
      const config = makeConfig({
        checks: {
          ...DEFAULT_CONFIG.checks,
          security: true,
          performance: false,
          maintainability: false,
          testing: false,
          documentation: false,
          style: false,
          'bug-risk': false,
          architecture: false,
        },
      });

      // Act
      const result = builder.buildSystemPrompt({ config, tech: 'react', mergedRulesText: '' });

      // Extract just the line listing enabled categories
      const checksLine = result.match(/\*\*Enabled check categories:\*\* (.+)/)?.[1] ?? '';

      // Assert
      expect(checksLine).toContain('security');
      expect(checksLine).not.toContain('performance');
    });

    it('should include the merged rules text in the prompt', () => {
      // Arrange
      const config = makeConfig();
      const mergedRulesText = '## security\n\nNever expose secrets.';

      // Act
      const result = builder.buildSystemPrompt({ config, tech: 'nestjs', mergedRulesText });

      // Assert
      expect(result).toContain('Never expose secrets.');
    });

    it('should include tech stack display name', () => {
      // Arrange
      const config = makeConfig();

      // Act
      const result = builder.buildSystemPrompt({ config, tech: 'nextjs', mergedRulesText: '' });

      // Assert
      expect(result).toContain('Next.js');
    });

    it('should include the actionable finding gate anti-FP rules', () => {
      // Arrange
      const config = makeConfig();

      // Act
      const result = builder.buildSystemPrompt({ config, tech: 'typescript', mergedRulesText: '' });

      // Assert
      expect(result).toContain('Actionable finding gate');
      expect(result).toContain('Already present');
      expect(result).toContain('Scope creep');
      expect(result).toContain('Hermetic testing');
      expect(result).toContain('Future ops');
    });
  });

  describe('buildUserPrompt', () => {
    it('should include PR title when provided', () => {
      // Arrange
      const files = [makeFile()];

      // Act
      const result = builder.buildUserPrompt({ files, prTitle: 'Fix auth bug' });

      // Assert
      expect(result).toContain('Fix auth bug');
    });

    it('should include PR body when provided', () => {
      // Arrange
      const files = [makeFile()];

      // Act
      const result = builder.buildUserPrompt({ files, prBody: 'Closes #123' });

      // Assert
      expect(result).toContain('Closes #123');
    });

    it('should NOT include PR title section when absent', () => {
      // Arrange
      const files = [makeFile()];

      // Act
      const result = builder.buildUserPrompt({ files });

      // Assert
      expect(result).not.toContain('PR title');
    });

    it('should mark a file as truncated when diff exceeds maxTotalChars', () => {
      // Arrange
      const largePatch = '+' + 'x'.repeat(5000);
      const files = [makeFile({ patch: largePatch })];

      // Act
      const result = builder.buildUserPrompt({ files, maxTotalChars: 100 });

      // Assert
      expect(result).toContain('Diff truncated');
    });

    it('should show no patch message for files without a patch', () => {
      // Arrange
      const files = [makeFile({ patch: undefined })];

      // Act
      const result = builder.buildUserPrompt({ files });

      // Assert
      expect(result).toContain('no patch available');
    });

    it('should include the count of changed files', () => {
      // Arrange
      const files = [makeFile(), makeFile({ path: 'src/bar.ts' })];

      // Act
      const result = builder.buildUserPrompt({ files });

      // Assert
      expect(result).toContain('Changed files (2)');
    });
  });

  describe('buildIncrementalSystemPrompt', () => {
    it('should contain the incremental-specific opening instruction', () => {
      // Arrange
      const config = makeConfig();

      // Act
      const result = builder.buildIncrementalSystemPrompt({ config, tech: 'typescript', mergedRulesText: '' });

      // Assert
      expect(result).toContain('INCREMENTAL, VERIFY-ONLY re-review');
    });

    it('should NOT contain the full-review opening sentence', () => {
      // Arrange
      const config = makeConfig();

      // Act
      const result = builder.buildIncrementalSystemPrompt({ config, tech: 'typescript', mergedRulesText: '' });

      // Assert
      expect(result).not.toContain('detect real bugs, security risks');
    });

    it('should still include tech stack and severity scale', () => {
      // Arrange
      const config = makeConfig({ minSeverity: 'major' });

      // Act
      const result = builder.buildIncrementalSystemPrompt({ config, tech: 'nestjs', mergedRulesText: '' });

      // Assert
      expect(result).toContain('NestJS');
      expect(result).toContain('major');
    });
  });

  describe('buildIncrementalUserPrompt', () => {
    it('should include the prior open findings section', () => {
      // Arrange
      const files = [makeFile()];
      const priorFindings = [
        { file: 'src/auth.ts', line: 42, severity: 'major', title: 'SQL injection', description: 'User input in query.' },
      ];

      // Act
      const result = builder.buildIncrementalUserPrompt({ files, priorFindings });

      // Assert
      expect(result).toContain('Prior open findings');
      expect(result).toContain('SQL injection');
      expect(result).toContain('src/auth.ts');
    });

    it('should include the new diff section', () => {
      // Arrange
      const files = [makeFile({ path: 'src/new-feature.ts' })];
      const priorFindings = [
        { file: 'src/foo.ts', line: 1, severity: 'minor', title: 'Missing null check', description: 'Could be null.' },
      ];

      // Act
      const result = builder.buildIncrementalUserPrompt({ files, priorFindings });

      // Assert
      expect(result).toContain('New changes in this push');
      expect(result).toContain('src/new-feature.ts');
    });

    it('should truncate large diffs when they exceed maxTotalChars', () => {
      // Arrange
      const largePatch = '+' + 'x'.repeat(5000);
      const files = [makeFile({ patch: largePatch })];
      const priorFindings = [
        { file: 'src/foo.ts', line: 1, severity: 'minor', title: 'Example', description: 'Details.' },
      ];

      // Act
      const result = builder.buildIncrementalUserPrompt({ files, priorFindings, maxTotalChars: 100 });

      // Assert
      expect(result).toContain('Diff truncated');
    });

    it('should show (none) when prior findings list is empty', () => {
      // Arrange
      const files = [makeFile()];

      // Act
      const result = builder.buildIncrementalUserPrompt({ files, priorFindings: [] });

      // Assert
      expect(result).toContain('_(none)_');
    });
  });

  describe('buildFeedbackEvaluationPrompt', () => {
    it('should include the finding title, file, and line in the prompt', () => {
      // Arrange
      const args = {
        findingTitle: 'Missing JWT signature check',
        findingDescription: 'The token is not verified before use.',
        findingSeverity: 'major',
        findingFile: 'src/auth.ts',
        findingLine: 42,
        devReply: 'I added verification in the previous commit.',
        fileWindow: 'const verify = true;',
        language: 'es' as const,
      };

      // Act
      const result = builder.buildFeedbackEvaluationPrompt(args);

      // Assert
      expect(result).toContain('Missing JWT signature check');
      expect(result).toContain('src/auth.ts');
      expect(result).toContain('42');
    });

    it('should include the developer reply verbatim', () => {
      // Arrange
      const args = {
        findingTitle: 'Some finding',
        findingDescription: 'Description here.',
        findingSeverity: 'minor',
        findingFile: 'src/util.ts',
        findingLine: 10,
        devReply: 'I fixed this in commit abc123.',
        fileWindow: '',
        language: 'es' as const,
      };

      // Act
      const result = builder.buildFeedbackEvaluationPrompt(args);

      // Assert
      expect(result).toContain('I fixed this in commit abc123.');
    });

    it('should include the file window content', () => {
      // Arrange
      const args = {
        findingTitle: 'Title',
        findingDescription: 'Desc',
        findingSeverity: 'info',
        findingFile: 'src/x.ts',
        findingLine: 5,
        devReply: 'reply',
        fileWindow: 'const answer = 42;',
        language: 'en' as const,
      };

      // Act
      const result = builder.buildFeedbackEvaluationPrompt(args);

      // Assert
      expect(result).toContain('const answer = 42;');
    });

    it('should include Spanish language instruction when language is es', () => {
      // Arrange
      const args = {
        findingTitle: 'T',
        findingDescription: 'D',
        findingSeverity: 'info',
        findingFile: 'f.ts',
        findingLine: 1,
        devReply: 'r',
        fileWindow: '',
        language: 'es' as const,
      };

      // Act
      const result = builder.buildFeedbackEvaluationPrompt(args);

      // Assert
      expect(result).toContain('español');
    });
  });
});
