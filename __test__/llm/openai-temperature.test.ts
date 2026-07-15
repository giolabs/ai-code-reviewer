import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

const { OpenAIAdapter } = await import('../../src/llm/openai.js');

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'fake-key');
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: '{}' } }],
    usage: undefined,
  });
});

describe('OpenAIAdapter.review temperature handling', () => {
  it('should omit temperature for gpt-5 reasoning models', async () => {
    // Arrange
    const adapter = new OpenAIAdapter({ provider: 'openai', model: 'gpt-5-nano-2025-08-07' });

    // Act
    await adapter.review({ systemPrompt: 'sys', userPrompt: 'usr' });

    // Assert
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('temperature');
  });

  it('should send the configured temperature for standard models like gpt-4o-mini', async () => {
    // Arrange
    const adapter = new OpenAIAdapter({ provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2 });

    // Act
    await adapter.review({ systemPrompt: 'sys', userPrompt: 'usr' });

    // Assert
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ temperature: 0.2 });
  });
});
