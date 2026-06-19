/**
 * Niveles de severidad de un finding del review.
 */
export type Severity = 'critical' | 'major' | 'minor' | 'info' | 'nitpick';
/**
 * Categorías de checks que el reviewer puede ejecutar.
 */
export type CheckCategory = 'security' | 'performance' | 'maintainability' | 'testing' | 'documentation' | 'style' | 'bug-risk' | 'architecture';
/**
 * Tech stacks soportados con templates de reglas built-in.
 */
export type TechStack = 'nestjs' | 'react' | 'nextjs' | 'typescript' | 'node' | 'flutter' | 'laravel' | 'generic';
export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama';
/**
 * Configuración cargada desde `.ai-review.yml` o `.ai-review.json`.
 */
export interface ReviewerConfig {
    /** LLM provider (default: openai) */
    provider: ProviderName;
    /** Modelo del provider. Alias backward-compatible; providerModel toma precedencia */
    model: string;
    /** Modelo del provider (toma precedencia sobre model) */
    providerModel?: string;
    /** URL de Ollama (solo para provider ollama) */
    ollamaUrl?: string;
    /** Idioma del review (default: es) */
    language: 'es' | 'en';
    /** Path al archivo de reglas custom (markdown) */
    rules?: string;
    /** Tech stack forzado. Si no se especifica, se auto-detecta */
    tech?: TechStack;
    /** Globs/paths a ignorar */
    ignore: string[];
    /** Severidad mínima a reportar (default: minor) */
    minSeverity: Severity;
    /** Tamaño máximo de archivo a revisar en bytes (default: 100000) */
    maxFileSize: number;
    /** Categorías de checks habilitadas */
    checks: Record<CheckCategory, boolean>;
    /** Postear como inline comments en PR (default: true) */
    inlineComments: boolean;
    /** Postear un summary general en PR (default: true) */
    summaryComment: boolean;
    /** Cantidad máxima de inline comments a postear (default: 20) */
    maxInlineComments: number;
    /** Prompt extra para customizar el review */
    customInstructions?: string;
}
/**
 * Un finding individual del review (un comentario sobre código).
 */
export interface ReviewFinding {
    /** Path relativo al archivo */
    file: string;
    /** Línea afectada (en el nuevo contenido) */
    line: number;
    /** Severidad */
    severity: Severity;
    /** Categoría */
    category: CheckCategory;
    /** Título corto del issue */
    title: string;
    /** Descripción detallada con contexto y razón */
    description: string;
    /** Sugerencia de fix (opcional, formato markdown/code block) */
    suggestion?: string;
}
/**
 * Resultado completo de un review sobre uno o más archivos.
 */
export interface ReviewResult {
    /** Resumen ejecutivo en lenguaje natural */
    summary: string;
    /** Lista de findings */
    findings: ReviewFinding[];
    /** Score general del PR de 0 a 10 */
    overallScore?: number;
    /** Recomendación */
    recommendation: 'approve' | 'comment' | 'request_changes';
    /** Tokens usados (para tracking de costo) */
    tokensUsed?: {
        prompt: number;
        completion: number;
        total: number;
    };
}
/**
 * Representa un archivo cambiado en un PR/diff.
 */
export interface ChangedFile {
    /** Path relativo */
    path: string;
    /** Status del cambio */
    status: 'added' | 'modified' | 'removed' | 'renamed';
    /** Diff unificado del archivo (con headers @@) */
    patch?: string;
    /** Contenido completo del archivo después del cambio (si es razonable cargarlo) */
    content?: string;
    /** Líneas agregadas */
    additions: number;
    /** Líneas removidas */
    deletions: number;
}
/**
 * Contexto del PR para postear reviews.
 */
export interface PullRequestContext {
    owner: string;
    repo: string;
    pullNumber: number;
    /** SHA del último commit del PR (para inline comments) */
    headSha: string;
    /** SHA del base branch */
    baseSha: string;
    /** Título del PR */
    title: string;
    /** Body del PR */
    body: string | null;
}
