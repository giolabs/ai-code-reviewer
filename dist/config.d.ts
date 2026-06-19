import type { ReviewerConfig } from './types.js';
/**
 * Configuración por defecto. Cualquier campo no especificado por el usuario
 * cae acá.
 */
export declare const DEFAULT_CONFIG: ReviewerConfig;
/**
 * Busca el archivo de configuración en cwd. Si se pasa un path explícito,
 * lo usa directamente.
 */
export declare function findConfigFile(explicitPath?: string, cwd?: string): string | null;
/**
 * Carga la configuración desde archivo + defaults. Si no hay archivo, retorna
 * defaults sin warning (es válido correr sin config).
 */
export declare function loadConfig(explicitPath?: string, cwd?: string): ReviewerConfig;
/**
 * Lee el archivo de reglas custom (markdown). Si no existe, retorna null.
 */
export declare function loadRulesFile(rulesPath: string | undefined, cwd?: string): string | null;
/**
 * Carga un template built-in de reglas por tech stack desde `templates/`.
 */
export declare function loadBuiltinTemplate(tech: string): string | null;
/**
 * Versión simple de glob matching. Soporta `**`, `*`, y nombres literales.
 * Suficiente para los patterns de ignore más comunes.
 *
 * Implementación: primero reemplazamos `**` con un placeholder único, después
 * `*` con `[^/]*`, y al final el placeholder por `.*`. Si hacemos `**` → `.*`
 * directamente, el `*` resultante es pisado por el reemplazo siguiente.
 */
export declare function matchesPattern(path: string, pattern: string): boolean;
/**
 * Filtra una lista de paths según los patterns de ignore del config.
 */
export declare function filterIgnored(paths: string[], ignorePatterns: string[]): string[];
