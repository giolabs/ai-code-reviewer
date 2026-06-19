import type { CheckCategory, TechStack } from './types.js';
import { loadBuiltinTemplate } from './config.js';
import { loadRulesFile } from './config.js';

export type CategoryRules = Partial<Record<CheckCategory | '_general', string>>;

/**
 * Parsea un archivo markdown de reglas en secciones por categoria.
 * Busca headings H2 cuyo titulo coincida con un CheckCategory.
 * Contenido fuera de un H2 de categoria va a `_general`.
 */
function parseRulesByCategory(markdown: string): CategoryRules {
  const categories: CheckCategory[] = [
    'security',
    'performance',
    'maintainability',
    'testing',
    'documentation',
    'style',
    'bug-risk',
    'architecture',
  ];

  const rules: CategoryRules = {};
  let currentCategory: CheckCategory | '_general' = '_general';
  const lines = markdown.split('\n');
  const sections: Record<string, string[]> = { _general: [] };

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      const heading = h2Match[1].trim().toLowerCase();
      const matched = categories.find((c) => heading === c || heading.startsWith(c));
      if (matched) {
        currentCategory = matched;
        if (!sections[currentCategory]) sections[currentCategory] = [];
        continue;
      }
    }
    if (!sections[currentCategory]) sections[currentCategory] = [];
    sections[currentCategory].push(line);
  }

  for (const [key, value] of Object.entries(sections)) {
    const content = value.join('\n').trim();
    if (content) {
      rules[key as CheckCategory | '_general'] = content;
    }
  }

  return rules;
}

export function loadProjectRules(rulesPath: string | undefined, cwd: string): CategoryRules {
  const content = loadRulesFile(rulesPath, cwd);
  if (!content) return {};
  return parseRulesByCategory(content);
}

export function loadGlobalRules(tech: TechStack): CategoryRules {
  const content = loadBuiltinTemplate(tech) ?? loadBuiltinTemplate('generic') ?? '';
  if (!content) return {};
  return parseRulesByCategory(content);
}

export function mergeRules(
  project: CategoryRules,
  global: CategoryRules,
  enabledChecks: Record<CheckCategory, boolean>,
): string {
  const sections: string[] = [];

  // General rules (not category-specific) — project first, then global
  const generalParts: string[] = [];
  if (project._general) generalParts.push(project._general);
  if (global._general) generalParts.push(global._general);
  if (generalParts.length > 0) {
    sections.push(generalParts.join('\n\n'));
  }

  const categories = Object.entries(enabledChecks)
    .filter(([, enabled]) => enabled)
    .map(([cat]) => cat as CheckCategory);

  for (const cat of categories) {
    const projectRule = project[cat];
    const globalRule = global[cat];
    const rule = projectRule || globalRule;
    if (rule) {
      sections.push(`## ${cat}\n\n${rule}`);
    }
  }

  return sections.join('\n\n');
}
