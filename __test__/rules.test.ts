import { describe, it, expect, vi } from 'vitest';
import { RulesLoader } from '../src/rules.js';
import type { TechStack } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/config.js';

interface ConfigLoaderLike {
  loadRulesFile: (rulesPath: string | undefined) => string | null;
  loadBuiltinTemplate: (tech: string) => string | null;
}

function makeConfigLoader(overrides: Partial<ConfigLoaderLike> = {}): ConfigLoaderLike {
  return {
    loadRulesFile: vi.fn<ConfigLoaderLike['loadRulesFile']>().mockReturnValue(null),
    loadBuiltinTemplate: vi.fn<ConfigLoaderLike['loadBuiltinTemplate']>().mockReturnValue(null),
    ...overrides,
  };
}

describe('RulesLoader', () => {
  describe('loadProjectRules', () => {
    it('should return empty object when configLoader returns null', () => {
      // Arrange
      const configLoader = makeConfigLoader();
      const loader = new RulesLoader({ configLoader: configLoader as never });

      // Act
      const result = loader.loadProjectRules({ rulesPath: undefined, cwd: '/tmp' });

      // Assert
      expect(result).toEqual({});
    });

    it('should parse markdown into category rules when content is returned', () => {
      // Arrange
      const markdown = '## security\n\nNever expose tokens in logs.\n';
      const configLoader = makeConfigLoader({
        loadRulesFile: vi.fn<ConfigLoaderLike['loadRulesFile']>().mockReturnValue(markdown),
      });
      const loader = new RulesLoader({ configLoader: configLoader as never });

      // Act
      const result = loader.loadProjectRules({ rulesPath: 'rules.md', cwd: '/tmp' });

      // Assert
      expect(result.security).toContain('Never expose tokens in logs.');
    });

    it('should place content before any category heading into _general', () => {
      // Arrange
      const markdown = 'General rule for all categories.\n\n## security\n\nSpecific security rule.\n';
      const configLoader = makeConfigLoader({
        loadRulesFile: vi.fn<ConfigLoaderLike['loadRulesFile']>().mockReturnValue(markdown),
      });
      const loader = new RulesLoader({ configLoader: configLoader as never });

      // Act
      const result = loader.loadProjectRules({ rulesPath: 'rules.md', cwd: '/tmp' });

      // Assert
      expect(result._general).toContain('General rule for all categories.');
    });
  });

  describe('loadGlobalRules', () => {
    it('should return empty object when no template is found', () => {
      // Arrange
      const configLoader = makeConfigLoader();
      const loader = new RulesLoader({ configLoader: configLoader as never });

      // Act
      const result = loader.loadGlobalRules('generic' as TechStack);

      // Assert
      expect(result).toEqual({});
    });

    it('should call loadBuiltinTemplate with the tech stack', () => {
      // Arrange
      const loadBuiltinTemplate = vi
        .fn<ConfigLoaderLike['loadBuiltinTemplate']>()
        .mockReturnValue(null);
      const configLoader = makeConfigLoader({ loadBuiltinTemplate });
      const loader = new RulesLoader({ configLoader: configLoader as never });

      // Act
      loader.loadGlobalRules('nestjs' as TechStack);

      // Assert
      expect(loadBuiltinTemplate).toHaveBeenCalledWith('nestjs');
    });

    it('should fall back to generic template when tech template is null', () => {
      // Arrange
      const loadBuiltinTemplate = vi
        .fn<ConfigLoaderLike['loadBuiltinTemplate']>()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce('## security\n\nGeneric security rule.\n');
      const configLoader = makeConfigLoader({ loadBuiltinTemplate });
      const loader = new RulesLoader({ configLoader: configLoader as never });

      // Act
      const result = loader.loadGlobalRules('laravel' as TechStack);

      // Assert
      expect(loadBuiltinTemplate).toHaveBeenNthCalledWith(2, 'generic');
      expect(result.security).toContain('Generic security rule.');
    });
  });

  describe('mergeRules', () => {
    const enabledChecks = DEFAULT_CONFIG.checks;

    it('should prefer project rule over global rule for same category', () => {
      // Arrange
      const configLoader = makeConfigLoader();
      const loader = new RulesLoader({ configLoader: configLoader as never });

      // Act
      const result = loader.mergeRules({
        project: { security: 'Project security rule.' },
        global: { security: 'Global security rule.' },
        enabledChecks,
      });

      // Assert
      expect(result).toContain('Project security rule.');
      expect(result).not.toContain('Global security rule.');
    });

    it('should exclude disabled categories from output', () => {
      // Arrange
      const configLoader = makeConfigLoader();
      const loader = new RulesLoader({ configLoader: configLoader as never });
      const checks = { ...enabledChecks, style: false, documentation: false };

      // Act
      const result = loader.mergeRules({
        project: { style: 'Style rule.' },
        global: {},
        enabledChecks: checks,
      });

      // Assert
      expect(result).not.toContain('Style rule.');
    });

    it('should place _general sections before category sections', () => {
      // Arrange
      const configLoader = makeConfigLoader();
      const loader = new RulesLoader({ configLoader: configLoader as never });

      // Act
      const result = loader.mergeRules({
        project: { _general: 'General preamble.' },
        global: { security: 'Security rule.' },
        enabledChecks,
      });

      // Assert
      const generalIndex = result.indexOf('General preamble.');
      const securityIndex = result.indexOf('Security rule.');
      expect(generalIndex).toBeLessThan(securityIndex);
    });
  });
});
