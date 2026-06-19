import type { ReviewResult, ReviewFinding, Severity } from './types.js';
export declare function sortFindings(findings: ReviewFinding[]): ReviewFinding[];
/**
 * Imprime el review en terminal con colores.
 */
export declare function printReviewToTerminal(result: ReviewResult): void;
/**
 * Convierte el review a markdown (para guardar a archivo o como PR comment).
 */
export declare function reviewToMarkdown(result: ReviewResult): string;
/**
 * Filtra findings por severidad mínima.
 */
export declare function filterBySeverity(findings: ReviewFinding[], minSeverity: Severity): ReviewFinding[];
