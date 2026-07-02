import { useRouter } from 'next/router'
import type { DocsThemeConfig } from 'nextra-theme-docs'
import type { ReactElement } from 'react'

function LanguageSwitcher(): ReactElement {
  const { asPath } = useRouter()
  const isEs = asPath.startsWith('/es/')
  const target = isEs
    ? asPath.replace(/^\/es\//, '/')
    : '/es' + (asPath === '/' ? '/getting-started' : asPath)
  return (
    <a
      href={'/ai-code-reviewer' + target}
      style={{
        marginLeft: 8,
        fontSize: 14,
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid currentColor',
        opacity: 0.7,
        textDecoration: 'none',
      }}
    >
      {isEs ? 'English' : 'Español'}
    </a>
  )
}

const config: DocsThemeConfig = {
  logo: <span style={{ fontWeight: 700 }}>ai-code-reviewer</span>,
  project: {
    link: 'https://github.com/giolabs/ai-code-reviewer',
  },
  docsRepositoryBase: 'https://github.com/giolabs/ai-code-reviewer/tree/main/docs',
  useNextSeoProps() {
    return { titleTemplate: '%s – ai-code-reviewer' }
  },
  navbar: {
    extraContent: LanguageSwitcher,
  },
  footer: {
    text: 'MIT License © Giolabs',
  },
}

export default config
