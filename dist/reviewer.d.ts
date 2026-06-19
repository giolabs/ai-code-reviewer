interface ReviewerCliOptions {
    configPath?: string;
    rulesPath?: string;
    model?: string;
    provider?: string;
    language?: 'es' | 'en';
    tech?: string;
    save?: string;
    dryRun?: boolean;
    minSeverity?: string;
}
export interface ReviewPRResult {
    recommendation: string;
    findingsCount: number;
}
export declare function reviewPullRequest(opts: ReviewerCliOptions): Promise<ReviewPRResult | null>;
export declare function reviewSingleFile(filePath: string, opts: ReviewerCliOptions): Promise<void>;
export declare function reviewLocalDiff(opts: ReviewerCliOptions & {
    staged?: boolean;
    base?: string;
}): Promise<void>;
export {};
