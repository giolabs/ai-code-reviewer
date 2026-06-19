import type { ChangedFile, ReviewerConfig, TechStack } from './types.js';
export declare function buildSystemPrompt(args: {
    config: ReviewerConfig;
    tech: TechStack;
    mergedRulesText: string;
}): string;
/**
 * Construye el user prompt con el contenido a revisar. Trunca diffs gigantes
 * para no explotar el context window.
 */
export declare function buildUserPrompt(args: {
    files: ChangedFile[];
    prTitle?: string;
    prBody?: string | null;
    maxTotalChars?: number;
}): string;
