import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../src/prompts.js';

describe('PromptBuilder.buildAskPrompt', () => {
  it('should include the question and the file-window context', () => {
    // Arrange
    const builder = new PromptBuilder();

    // Act
    const result = builder.buildAskPrompt({
      question: 'why is this flagged as major?',
      contextKind: 'file-window',
      context: 'const x = registry.resolveAdapter(type);',
      language: 'es',
    });

    // Assert
    expect(result).toContain('why is this flagged as major?');
    expect(result).toContain('const x = registry.resolveAdapter(type);');
    expect(result).toContain('Current file state around the comment:');
  });

  it('should include the pr-summary context label when contextKind is pr-summary', () => {
    // Arrange
    const builder = new PromptBuilder();

    // Act
    const result = builder.buildAskPrompt({
      question: 'what does this PR change in the public API?',
      contextKind: 'pr-summary',
      context: '## AI Code Review\n\nSummary text.',
      language: 'en',
    });

    // Assert
    expect(result).toContain('what does this PR change in the public API?');
    expect(result).toContain('Pull request summary and description:');
    expect(result).toContain('Summary text.');
  });

  it('should use Spanish instructions when language is es', () => {
    // Arrange
    const builder = new PromptBuilder();

    // Act
    const result = builder.buildAskPrompt({
      question: 'q',
      contextKind: 'pr-summary',
      context: 'c',
      language: 'es',
    });

    // Assert
    expect(result).toContain('Respondé en español rioplatense');
  });
});
