import { describe, it, expect, vi } from 'vitest';
import { LearningsStore } from '../src/learnings-store.js';
import type { GitHubClient } from '../src/github.js';

function makeGitHubClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getFileAtRef: vi.fn().mockResolvedValue(null),
    getFileWithSha: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as GitHubClient;
}

describe('LearningsStore.formatEntry', () => {
  it('should format an entry with actor, PR number, and date', () => {
    // Arrange / Act
    const result = LearningsStore.formatEntry({
      text: 'No reportar console.log en scripts/migrations/**',
      actor: 'lucasgio',
      pullNumber: 67,
      date: '2026-07-15',
    });

    // Assert
    expect(result).toBe('- No reportar console.log en scripts/migrations/** (agregado por @lucasgio, PR #67, 2026-07-15)');
  });
});

describe('LearningsStore.read', () => {
  it('should return the file content when it exists', async () => {
    // Arrange
    const client = makeGitHubClient({ getFileAtRef: vi.fn().mockResolvedValue('# AI Reviewer Learnings\n\n- rule one') });
    const store = new LearningsStore();

    // Act
    const result = await store.read({ githubClient: client, owner: 'org', repo: 'repo', baseRefName: 'main' });

    // Assert
    expect(result).toBe('# AI Reviewer Learnings\n\n- rule one');
  });

  it('should return an empty string when the file does not exist yet', async () => {
    // Arrange
    const client = makeGitHubClient({ getFileAtRef: vi.fn().mockResolvedValue(null) });
    const store = new LearningsStore();

    // Act
    const result = await store.read({ githubClient: client, owner: 'org', repo: 'repo', baseRefName: 'main' });

    // Assert
    expect(result).toBe('');
  });
});

describe('LearningsStore.append', () => {
  it('should create the file with a header when none exists', async () => {
    // Arrange
    const createOrUpdateFile = vi.fn().mockResolvedValue(undefined);
    const client = makeGitHubClient({
      getFileWithSha: vi.fn().mockResolvedValue(null),
      createOrUpdateFile,
    });
    const store = new LearningsStore();

    // Act
    const result = await store.append({
      githubClient: client,
      owner: 'org',
      repo: 'repo',
      baseRefName: 'main',
      entry: '- first rule (agregado por @dev, PR #1, 2026-07-15)',
      maxChars: 4000,
    });

    // Assert
    expect(result).toBe(true);
    const call = vi.mocked(createOrUpdateFile).mock.calls[0][0] as { content: string; sha?: string };
    expect(call.content).toContain('# AI Reviewer Learnings');
    expect(call.content).toContain('- first rule');
    expect(call.sha).toBeUndefined();
  });

  it('should preserve prior bullets and pass the existing sha when appending', async () => {
    // Arrange
    const createOrUpdateFile = vi.fn().mockResolvedValue(undefined);
    const client = makeGitHubClient({
      getFileWithSha: vi.fn().mockResolvedValue({
        content: '# AI Reviewer Learnings\n\n- old rule (agregado por @dev, PR #1, 2026-01-01)',
        sha: 'abc123',
      }),
      createOrUpdateFile,
    });
    const store = new LearningsStore();

    // Act
    await store.append({
      githubClient: client,
      owner: 'org',
      repo: 'repo',
      baseRefName: 'main',
      entry: '- new rule (agregado por @dev, PR #2, 2026-07-15)',
      maxChars: 4000,
    });

    // Assert
    const call = vi.mocked(createOrUpdateFile).mock.calls[0][0] as { content: string; sha?: string };
    expect(call.content).toContain('- old rule');
    expect(call.content).toContain('- new rule');
    expect(call.sha).toBe('abc123');
  });

  it('should drop the oldest bullets first when the result would exceed maxChars', async () => {
    // Arrange
    const createOrUpdateFile = vi.fn().mockResolvedValue(undefined);
    const client = makeGitHubClient({
      getFileWithSha: vi.fn().mockResolvedValue({
        content: '# AI Reviewer Learnings\n\n- oldest rule\n- middle rule',
        sha: 'abc123',
      }),
      createOrUpdateFile,
    });
    const store = new LearningsStore();

    // Act
    await store.append({
      githubClient: client,
      owner: 'org',
      repo: 'repo',
      baseRefName: 'main',
      entry: '- newest rule',
      maxChars: 60,
    });

    // Assert
    const call = vi.mocked(createOrUpdateFile).mock.calls[0][0] as { content: string };
    expect(call.content).not.toContain('oldest rule');
    expect(call.content).toContain('newest rule');
  });

  it('should keep at least one entry even if it alone exceeds maxChars', async () => {
    // Arrange
    const createOrUpdateFile = vi.fn().mockResolvedValue(undefined);
    const client = makeGitHubClient({
      getFileWithSha: vi.fn().mockResolvedValue(null),
      createOrUpdateFile,
    });
    const store = new LearningsStore();
    const longEntry = `- ${'x'.repeat(200)}`;

    // Act
    const result = await store.append({
      githubClient: client,
      owner: 'org',
      repo: 'repo',
      baseRefName: 'main',
      entry: longEntry,
      maxChars: 10,
    });

    // Assert
    expect(result).toBe(true);
    const call = vi.mocked(createOrUpdateFile).mock.calls[0][0] as { content: string };
    expect(call.content).toContain(longEntry);
  });

  it('should retry once on a 409 conflict and succeed on the second attempt', async () => {
    // Arrange
    const conflict = Object.assign(new Error('conflict'), { status: 409 });
    const createOrUpdateFile = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(undefined);
    const client = makeGitHubClient({
      getFileWithSha: vi.fn().mockResolvedValue(null),
      createOrUpdateFile,
    });
    const store = new LearningsStore();

    // Act
    const result = await store.append({
      githubClient: client,
      owner: 'org',
      repo: 'repo',
      baseRefName: 'main',
      entry: '- rule',
      maxChars: 4000,
    });

    // Assert
    expect(result).toBe(true);
    expect(createOrUpdateFile).toHaveBeenCalledTimes(2);
  });

  it('should give up and return false after a second conflict', async () => {
    // Arrange
    const conflict = Object.assign(new Error('conflict'), { status: 409 });
    const createOrUpdateFile = vi.fn().mockRejectedValue(conflict);
    const client = makeGitHubClient({
      getFileWithSha: vi.fn().mockResolvedValue(null),
      createOrUpdateFile,
    });
    const store = new LearningsStore();

    // Act
    const result = await store.append({
      githubClient: client,
      owner: 'org',
      repo: 'repo',
      baseRefName: 'main',
      entry: '- rule',
      maxChars: 4000,
    });

    // Assert
    expect(result).toBe(false);
    expect(createOrUpdateFile).toHaveBeenCalledTimes(2);
  });

  it('should return false without retrying on a non-conflict error', async () => {
    // Arrange
    const createOrUpdateFile = vi.fn().mockRejectedValue(new Error('forbidden'));
    const client = makeGitHubClient({
      getFileWithSha: vi.fn().mockResolvedValue(null),
      createOrUpdateFile,
    });
    const store = new LearningsStore();

    // Act
    const result = await store.append({
      githubClient: client,
      owner: 'org',
      repo: 'repo',
      baseRefName: 'main',
      entry: '- rule',
      maxChars: 4000,
    });

    // Assert
    expect(result).toBe(false);
    expect(createOrUpdateFile).toHaveBeenCalledTimes(1);
  });
});
