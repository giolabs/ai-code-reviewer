import type { DocsThemeConfig } from 'nextra-theme-docs'

const config: DocsThemeConfig = {
  logo: <span style={{ fontWeight: 700 }}>ai-code-reviewer</span>,
  project: {
    link: 'https://github.com/giolabs/ai-code-reviewer',
  },
  docsRepositoryBase: 'https://github.com/giolabs/ai-code-reviewer/tree/main/docs',
  useNextSeoProps() {
    return { titleTemplate: '%s – ai-code-reviewer' }
  },
  footer: {
    text: 'MIT License © Giolabs',
  },
}

export default config
