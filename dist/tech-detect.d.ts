import type { TechStack } from './types.js';
/**
 * Detecta el tech stack del proyecto leyendo `package.json` y archivos
 * característicos del root. El orden importa: stacks más específicos primero
 * (Next.js antes que React, NestJS antes que node).
 */
export declare function detectTechStack(cwd?: string): TechStack;
/**
 * Devuelve un nombre legible del tech stack para mostrar al usuario.
 */
export declare function techDisplayName(tech: TechStack): string;
