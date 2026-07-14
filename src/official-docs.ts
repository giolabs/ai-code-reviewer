import type { OfficialDocsConfig } from './types.js';

interface OfficialDocsProviderDeps {
  config: OfficialDocsConfig;
  apiKey?: string;
}

interface FetchDocsArgs {
  /** Library names detected in the diff (relevance-gating). */
  libraries: ReadonlyArray<string>;
}

const CONTEXT7_ENDPOINT = 'https://context7.com/api/v1/docs';

/**
 * Official stack docs grounding (Axis 8B). Opt-in and disabled by default.
 * Relevance-gated to the libraries touched by the diff. FAIL-OPEN: any error,
 * missing key, or rate limit returns null so the review never fails on it.
 *
 * This is a minimal skeleton: it wires config + fail-open fetch. Response
 * caching by `lib@version` (in the context comment) is a documented follow-up.
 */
export class OfficialDocsProvider {
  constructor(private readonly deps: OfficialDocsProviderDeps) {}

  isEnabled(): boolean {
    return this.deps.config.enabled && this.deps.config.provider === 'context7';
  }

  async fetchForLibraries(args: FetchDocsArgs): Promise<string | null> {
    if (!this.isEnabled()) return null;
    if (args.libraries.length === 0) return null;

    const apiKey = this.deps.apiKey ?? process.env.CONTEXT7_API_KEY;
    if (!apiKey) return null;

    const sections: string[] = [];
    for (const library of args.libraries.slice(0, 5)) {
      const snippet = await this.fetchOne({ library, apiKey });
      if (snippet) sections.push(`### ${library}\n${snippet}`);
    }

    return sections.length > 0 ? sections.join('\n\n') : null;
  }

  private async fetchOne(args: { library: string; apiKey: string }): Promise<string | null> {
    try {
      const url = `${CONTEXT7_ENDPOINT}?library=${encodeURIComponent(args.library)}`;
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${args.apiKey}` },
      });
      if (!response.ok) return null;
      const text = await response.text();
      return text.slice(0, 4_000);
    } catch {
      return null;
    }
  }
}
