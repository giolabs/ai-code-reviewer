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
});
