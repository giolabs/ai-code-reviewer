import type { CheckCategory, TechStack } from './types.js';
export type CategoryRules = Partial<Record<CheckCategory | '_general', string>>;
export declare function loadProjectRules(rulesPath: string | undefined, cwd: string): CategoryRules;
export declare function loadGlobalRules(tech: TechStack): CategoryRules;
export declare function mergeRules(project: CategoryRules, global: CategoryRules, enabledChecks: Record<CheckCategory, boolean>): string;
