import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectKnowledgeDigest } from '../src/project-knowledge.js';
import type { ProjectContextConfig } from '../src/types.js';

describe('ProjectKnowledgeDigest', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pkd-'));
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should rank an ADR matching the PR title into the digest before unrelated long docs', () => {
    // Arrange
    const filler = 'x'.repeat(4_000);
    writeFileSync(join(root, 'docs', 'unrelated-domain.md'), `# Unrelated\n${filler}`);
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-016-channel-logos-public-read.md'),
      '# ADR-016\nPublic-read logos bucket is intentional for MVP without CloudFront.\n',
    );
    const config: ProjectContextConfig = {
      claudeMd: false,
      docsGlobs: ['docs/adr/**/*.md', 'docs/**/domain*.md', 'docs/unrelated-domain.md'],
      maxChars: 2_500,
    };
    const digest = new ProjectKnowledgeDigest({ cwd: root });

    // Act
    const result = digest.build({
      config,
      changedPaths: ['infra/s3/logos-flowstore/bucket-policy.json'],
      prTitle: 'US-054: Channel logos from S3 — ADR-016',
      prBody: 'Implements ADR-016 public-read + CORS',
    });

    // Assert
    expect(result.digest).toContain('ADR-016');
    expect(result.digest).toContain('Public-read logos bucket');
  });
});
