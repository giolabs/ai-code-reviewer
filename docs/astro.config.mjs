import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://giolabs.github.io',
  base: '/ai-code-reviewer',
  integrations: [
    starlight({
      title: 'ai-code-reviewer',
      description: 'AI-powered code reviewer for GitHub PRs — supports OpenAI, Anthropic, Gemini and Ollama',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/giolabs/ai-code-reviewer' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Quick Start', slug: 'getting-started' },
            { label: 'Local Usage', slug: 'local-usage' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Providers', slug: 'providers' },
            { label: 'Configuration', slug: 'configuration' },
            { label: 'CLI Reference', slug: 'cli-reference' },
            { label: 'Tech Stacks', slug: 'tech-stacks' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Custom Rules', slug: 'custom-rules' },
            { label: 'Design Decisions', slug: 'design' },
          ],
        },
        {
          label: 'About',
          items: [
            { label: 'Known Limitations', slug: 'limitations' },
            { label: 'Changelog', slug: 'changelog' },
            { label: 'Troubleshooting', slug: 'troubleshooting' },
            { label: 'Contributing', slug: 'contributing' },
          ],
        },
      ],
    }),
  ],
});
