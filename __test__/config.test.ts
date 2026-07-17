import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigLoader, DEFAULT_CONFIG } from '../src/config.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `config-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('ConfigLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('should return DEFAULT_CONFIG when no config file exists', () => {
      // Arrange
      const loader = new ConfigLoader({ cwd: tempDir });

      // Act
      const result = loader.loadConfig();

      // Assert
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('should merge a valid .ai-review.yml over defaults', () => {
      // Arrange
      writeFileSync(join(tempDir, '.ai-review.yml'), 'language: en\nminSeverity: critical\n');
      const loader = new ConfigLoader({ cwd: tempDir });

      // Act
      const result = loader.loadConfig();

      // Assert
      expect(result.language).toBe('en');
      expect(result.minSeverity).toBe('critical');
      expect(result.provider).toBe(DEFAULT_CONFIG.provider);
    });

    it('should parse a .ai-review.json file correctly', () => {
      // Arrange
      writeFileSync(join(tempDir, '.ai-review.json'), JSON.stringify({ language: 'en' }));
      const loader = new ConfigLoader({ cwd: tempDir });

      // Act
      const result = loader.loadConfig();

      // Assert
      expect(result.language).toBe('en');
    });

    it('should throw when an explicit path does not exist', () => {
      // Arrange
      const loader = new ConfigLoader({ cwd: tempDir });

      // Act & Assert
      expect(() => loader.loadConfig('nonexistent.yml')).toThrow('Config file not found');
    });

    it('should deep-merge checks from the config file over defaults', () => {
      // Arrange
      writeFileSync(
        join(tempDir, '.ai-review.yml'),
        'checks:\n  documentation: true\n  style: true\n',
      );
      const loader = new ConfigLoader({ cwd: tempDir });

      // Act
      const result = loader.loadConfig();

      // Assert
      expect(result.checks.documentation).toBe(true);
      expect(result.checks.style).toBe(true);
      expect(result.checks.security).toBe(true);
    });
  });

  describe('loadRulesFile', () => {
    it('should return null when rulesPath is undefined', () => {
      // Arrange
      const loader = new ConfigLoader({ cwd: tempDir });

      // Act
      const result = loader.loadRulesFile(undefined);

      // Assert
      expect(result).toBeNull();
    });

    it('should throw when the rules file does not exist', () => {
      // Arrange
      const loader = new ConfigLoader({ cwd: tempDir });

      // Act & Assert
      expect(() => loader.loadRulesFile('missing-rules.md')).toThrow('Rules file not found');
    });

    it('should return file content when the rules file exists', () => {
      // Arrange
      writeFileSync(join(tempDir, 'rules.md'), '# My rules\n- rule one\n');
      const loader = new ConfigLoader({ cwd: tempDir });

      // Act
      const result = loader.loadRulesFile('rules.md');

      // Assert
      expect(result).toContain('My rules');
    });
  });

  describe('matchesPattern (static)', () => {
    it('should match node_modules/** against a nested path', () => {
      // Arrange / Act / Assert
      expect(ConfigLoader.matchesPattern('node_modules/chalk/index.js', 'node_modules/**')).toBe(true);
    });

    it('should match *.lock against yarn.lock', () => {
      // Arrange / Act / Assert
      expect(ConfigLoader.matchesPattern('yarn.lock', '*.lock')).toBe(true);
    });

    it('should NOT match src/foo.ts against node_modules/**', () => {
      // Arrange / Act / Assert
      expect(ConfigLoader.matchesPattern('src/foo.ts', 'node_modules/**')).toBe(false);
    });

    it('should let **/ match zero directories under docs/adr', () => {
      // Arrange / Act / Assert
      expect(ConfigLoader.matchesPattern('docs/adr/ADR-016.md', 'docs/adr/**/*.md')).toBe(true);
      expect(ConfigLoader.matchesPattern('docs/adr/ADR-016.md', 'docs/**/adr/**/*.md')).toBe(true);
    });
  });

  describe('filterIgnored (static)', () => {
    it('should remove paths matching ignore patterns', () => {
      // Arrange
      const paths = ['src/index.ts', 'node_modules/chalk/index.js', 'dist/cli.js'];
      const patterns = ['node_modules/**', 'dist/**'];

      // Act
      const result = ConfigLoader.filterIgnored(paths, patterns);

      // Assert
      expect(result).toEqual(['src/index.ts']);
    });

    it('should return all paths when no patterns match', () => {
      // Arrange
      const paths = ['src/a.ts', 'src/b.ts'];

      // Act
      const result = ConfigLoader.filterIgnored(paths, ['dist/**']);

      // Assert
      expect(result).toEqual(paths);
    });
  });
});
