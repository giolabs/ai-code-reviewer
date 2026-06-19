import * as core from '@actions/core';
import { reviewPullRequest } from './reviewer.js';

async function run(): Promise<void> {
  try {
    const opts = {
      provider: core.getInput('provider') || undefined,
      model: core.getInput('model') || undefined,
      language: (core.getInput('language') || undefined) as 'es' | 'en' | undefined,
      tech: core.getInput('tech') || undefined,
      configPath: core.getInput('config-path') || undefined,
      rulesPath: core.getInput('rules-path') || undefined,
      minSeverity: core.getInput('min-severity') || undefined,
      dryRun: core.getInput('dry-run') === 'true',
      save: undefined,
    };

    const result = await reviewPullRequest(opts);

    core.setOutput('review-posted', result ? 'true' : 'false');
    core.setOutput('findings-count', String(result?.findingsCount ?? 0));
    core.setOutput('recommendation', result?.recommendation ?? 'comment');
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
