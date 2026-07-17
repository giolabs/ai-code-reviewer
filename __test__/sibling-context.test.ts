import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SiblingContextLoader } from '../src/sibling-context.js';

describe('SiblingContextLoader', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sibling-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should include a sibling spec file next to a changed implementation file', () => {
    // Arrange
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'foo.ts'), 'export const foo = 1;\n');
    writeFileSync(
      join(root, 'src', 'foo.spec.ts'),
      "it('covers empty', () => { expect(resolve('')).toBeUndefined(); });\n",
    );
    const loader = new SiblingContextLoader({ cwd: root });

    // Act
    const result = loader.load({ changedPaths: ['src/foo.ts'] });

    // Assert
    expect(result.fileCount).toBe(1);
    expect(result.text).toContain('foo.spec.ts');
    expect(result.text).toContain("resolve('')");
  });

  it('should include an infra README when a file under that infra directory changed', () => {
    // Arrange
    mkdirSync(join(root, 'infra', 's3', 'logos'), { recursive: true });
    writeFileSync(join(root, 'infra', 's3', 'logos', 'bucket-policy.json'), '{"Version":"2012-10-17"}');
    writeFileSync(
      join(root, 'infra', 's3', 'logos', 'README.md'),
      '# Logos bucket\nManual verify via verify-public-access.sh. Hermetic Jest covers the policy.\n',
    );
    const loader = new SiblingContextLoader({ cwd: root });

    // Act
    const result = loader.load({ changedPaths: ['infra/s3/logos/bucket-policy.json'] });

    // Assert
    expect(result.fileCount).toBe(1);
    expect(result.text).toContain('README.md');
    expect(result.text).toContain('verify-public-access.sh');
  });
});
