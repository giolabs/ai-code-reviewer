import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TechDetector } from '../src/tech-detect.js';
import type { TechStack } from '../src/types.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `tech-detect-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePackageJson(dir: string, deps: Record<string, string>, devDeps: Record<string, string> = {}): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }),
  );
}

describe('TechDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detect', () => {
    it('should detect nextjs when next is in dependencies', () => {
      // Arrange
      writePackageJson(tempDir, { next: '14.0.0', react: '18.0.0' });
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detect();

      // Assert
      expect(result).toBe('nextjs');
    });

    it('should detect nestjs when @nestjs/core is in dependencies', () => {
      // Arrange
      writePackageJson(tempDir, { '@nestjs/core': '10.0.0' });
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detect();

      // Assert
      expect(result).toBe('nestjs');
    });

    it('should detect react when react is in dependencies (without next)', () => {
      // Arrange
      writePackageJson(tempDir, { react: '18.0.0' });
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detect();

      // Assert
      expect(result).toBe('react');
    });

    it('should detect flutter when pubspec.yaml exists', () => {
      // Arrange
      writeFileSync(join(tempDir, 'pubspec.yaml'), 'name: my_app\n');
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detect();

      // Assert
      expect(result).toBe('flutter');
    });

    it('should detect laravel when composer.json exists', () => {
      // Arrange
      writeFileSync(join(tempDir, 'composer.json'), '{}');
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detect();

      // Assert
      expect(result).toBe('laravel');
    });

    it('should return generic when no package.json or marker files exist', () => {
      // Arrange
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detect();

      // Assert
      expect(result).toBe('generic');
    });

    it('should return generic when package.json is malformed', () => {
      // Arrange
      writeFileSync(join(tempDir, 'package.json'), 'not valid json {{{{');
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detect();

      // Assert
      expect(result).toBe('generic');
    });

    it('should detect typescript when typescript is in devDependencies', () => {
      // Arrange
      writePackageJson(tempDir, {}, { typescript: '5.0.0' });
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detect();

      // Assert
      expect(result).toBe('typescript');
    });

    it('should return node when package.json has no recognized deps', () => {
      // Arrange
      writePackageJson(tempDir, { express: '4.0.0' });
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detect();

      // Assert
      expect(result).toBe('node');
    });
  });

  describe('detectAll', () => {
    it('should detect a different stack per directory', () => {
      // Arrange
      mkdirSync(join(tempDir, 'apps/web'), { recursive: true });
      writeFileSync(join(tempDir, 'apps/web', 'pubspec.yaml'), 'name: my_app\n');
      mkdirSync(join(tempDir, 'apps/api'), { recursive: true });
      writePackageJson(join(tempDir, 'apps/api'), { '@nestjs/core': '10.0.0' });
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detectAll(['apps/web', 'apps/api']);

      // Assert
      expect(result).toEqual([
        { dir: 'apps/web', tech: 'flutter' },
        { dir: 'apps/api', tech: 'nestjs' },
      ]);
    });

    it('should return generic for a configured directory that does not exist on disk', () => {
      // Arrange
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detectAll(['does/not/exist']);

      // Assert
      expect(result).toEqual([{ dir: 'does/not/exist', tech: 'generic' }]);
    });

    it('should return an empty array when given no directories', () => {
      // Arrange
      const detector = new TechDetector({ cwd: tempDir });

      // Act
      const result = detector.detectAll([]);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('displayName (static)', () => {
    it.each<[TechStack, string]>([
      ['nestjs', 'NestJS'],
      ['react', 'React'],
      ['nextjs', 'Next.js'],
      ['typescript', 'TypeScript'],
      ['node', 'Node.js'],
      ['flutter', 'Flutter'],
      ['laravel', 'Laravel'],
      ['generic', 'Generic'],
    ])('should return %s for tech %s', (tech, expected) => {
      // Arrange / Act
      const result = TechDetector.displayName(tech);

      // Assert
      expect(result).toBe(expected);
    });
  });
});
