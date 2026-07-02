const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
})

module.exports = withNextra({
  output: 'export',
  basePath: '/ai-code-reviewer',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
})
