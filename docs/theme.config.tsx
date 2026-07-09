import { useRouter } from 'next/router'
import { useEffect } from 'react'
import type { DocsThemeConfig } from 'nextra-theme-docs'
import type { ReactElement, ChangeEvent } from 'react'

const LANG_STORAGE_KEY = 'ai-reviewer-lang'
const BASE = '/ai-code-reviewer'

function LanguageSwitcher(): ReactElement {
  const { asPath } = useRouter()
  const isEs = asPath.startsWith('/es')
  const currentLang = isEs ? 'es' : 'en'

  useEffect(() => {
    // Auto-redirect on first visit only (no saved preference yet)
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    if (saved) return

    const browserLang = navigator.language.toLowerCase()
    if (browserLang.startsWith('es') && !isEs) {
      const esTarget = asPath === '/' ? `${BASE}/es` : `${BASE}/es${asPath}`
      localStorage.setItem(LANG_STORAGE_KEY, 'es')
      window.location.replace(esTarget)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleChange(e: ChangeEvent<HTMLSelectElement>): void {
    const lang = e.target.value
    localStorage.setItem(LANG_STORAGE_KEY, lang)

    if (lang === 'es' && !isEs) {
      const target = asPath === '/' ? `${BASE}/es` : `${BASE}/es${asPath}`
      window.location.href = target
    } else if (lang === 'en' && isEs) {
      const enPath = asPath.replace(/^\/es/, '') || '/'
      window.location.href = BASE + enPath
    }
  }

  return (
    <select
      value={currentLang}
      onChange={handleChange}
      aria-label="Select documentation language"
      style={{
        marginLeft: 8,
        fontSize: 13,
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid currentColor',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        opacity: 0.8,
      }}
    >
      <option value="en">🇺🇸 EN</option>
      <option value="es">🇦🇷 ES</option>
    </select>
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
