import { describe, it, expect, vi } from 'vitest';
import { StackGrouper } from '../src/stack-grouper.js';
import type { ChangedFile } from '../src/types.js';

function makeFile(path: string): ChangedFile {
  return { path, status: 'modified', additions: 1, deletions: 0 };
}

describe('StackGrouper.normalizeAppDirs', () => {
  it('should return an empty array when appDir is undefined', () => {
    // Arrange / Act
    const result = StackGrouper.normalizeAppDirs(undefined);

    // Assert
    expect(result).toEqual([]);
  });

  it('should wrap a single string in an array', () => {
    // Arrange / Act
    const result = StackGrouper.normalizeAppDirs('apps/web');

    // Assert
    expect(result).toEqual(['apps/web']);
  });

  it('should pass an array through unchanged', () => {
    // Arrange / Act
    const result = StackGrouper.normalizeAppDirs(['apps/web', 'apps/api']);

    // Assert
    expect(result).toEqual(['apps/web', 'apps/api']);
  });
});

describe('StackGrouper.pickDir', () => {
  it('should pick the longest matching directory prefix', () => {
    // Arrange
    const grouper = new StackGrouper();

    // Act
    const result = grouper.pickDir('apps/web/lib/main.dart', ['apps/web', 'apps/web/lib']);

    // Assert
    expect(result).toBe('apps/web/lib');
  });

  it('should return null when no configured directory matches', () => {
    // Arrange
    const grouper = new StackGrouper();

    // Act
    const result = grouper.pickDir('README.md', ['apps/web', 'apps/api']);

    // Assert
    expect(result).toBeNull();
  });
});

describe('StackGrouper.group', () => {
  it('should assign each file to its configured directory group', () => {
    // Arrange
    const grouper = new StackGrouper();
    const files = [makeFile('apps/web/lib/main.dart'), makeFile('apps/api/src/main.ts'), makeFile('README.md')];
    const detection = {
      dirs: [
        { dir: 'apps/web', tech: 'flutter' as const },
        { dir: 'apps/api', tech: 'nestjs' as const },
      ],
      rootTech: 'generic' as const,
    };

    // Act
    const groups = grouper.group({ cwd: '/repo', files, maxStackGroups: 4, detection });

    // Assert
    expect(groups).toEqual([
      { dir: 'apps/web', tech: 'flutter', appCwd: '/repo/apps/web', files: [files[0]] },
      { dir: 'apps/api', tech: 'nestjs', appCwd: '/repo/apps/api', files: [files[1]] },
      { dir: '.', tech: 'generic', appCwd: '/repo', files: [files[2]] },
    ]);
  });

  it('should drop groups with zero changed files', () => {
    // Arrange
    const grouper = new StackGrouper();
    const files = [makeFile('apps/web/lib/main.dart')];
    const detection = {
      dirs: [
        { dir: 'apps/web', tech: 'flutter' as const },
        { dir: 'apps/api', tech: 'nestjs' as const },
      ],
      rootTech: 'generic' as const,
    };

    // Act
    const groups = grouper.group({ cwd: '/repo', files, maxStackGroups: 4, detection });

    // Assert
    expect(groups).toEqual([{ dir: 'apps/web', tech: 'flutter', appCwd: '/repo/apps/web', files: [files[0]] }]);
  });

  it('should fold the smallest groups into the fallback group when maxStackGroups is exceeded', () => {
    // Arrange
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const grouper = new StackGrouper();
    const files = [
      makeFile('a/1.ts'),
      makeFile('a/2.ts'),
      makeFile('a/3.ts'),
      makeFile('b/1.ts'),
      makeFile('b/2.ts'),
      makeFile('c/1.ts'),
    ];
    const detection = {
      dirs: [
        { dir: 'a', tech: 'node' as const },
        { dir: 'b', tech: 'react' as const },
        { dir: 'c', tech: 'typescript' as const },
      ],
      rootTech: 'generic' as const,
    };

    // Act
    const groups = grouper.group({ cwd: '/repo', files, maxStackGroups: 2, detection });

    // Assert: "a" (3 files) and "b" (2 files) survive; "c" (1 file) folds into fallback.
    expect(groups.map((g) => g.dir)).toEqual(['a', 'b', '.']);
    expect(groups.find((g) => g.dir === '.')?.files).toEqual([files[5]]);
    vi.restoreAllMocks();
  });
});
