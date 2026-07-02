import type { ReactElement } from 'react'
import Link from 'next/link'

const features = [
  {
    title: 'Multi-provider',
    description: 'OpenAI, Anthropic, Gemini, and Ollama. Switch with a single line in your config.',
    icon: '🤖',
  },
  {
    title: 'Inline comments',
    description: 'Findings posted directly on the diff lines in GitHub, with severity labels.',
    icon: '💬',
  },
  {
    title: 'Auto-approve',
    description: 'When all issues are resolved, the bot approves the PR automatically.',
    icon: '✅',
  },
  {
    title: 'Inline feedback',
    description: 'Reply /explain or /dismiss to any bot comment and it responds instantly.',
    icon: '↩️',
  },
  {
    title: 'Dependency graph',
    description: 'Analyzes callers and imports of changed files on JS/TS stacks for regression risks.',
    icon: '🕸️',
  },
  {
    title: 'Custom rules',
    description: 'Add your own review rules in Markdown. Your rules override built-in ones.',
    icon: '📋',
  },
]

const quickStartYaml = `name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  ai-review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npx -y @giolabsuy/ai-code-reviewer@latest review-pr
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`

export default function HomePage(): ReactElement {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Nav */}
      <header className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <span className="font-bold text-lg">ai-code-reviewer</span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/ai-code-reviewer/getting-started" className="hover:underline">Docs</Link>
          <a
            href="https://github.com/giolabs/ai-code-reviewer"
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            GitHub
          </a>
          <a
            href="/ai-code-reviewer/es/getting-started"
            className="border border-current rounded px-2 py-1 opacity-70 hover:opacity-100"
          >
            Español
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="inline-block bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-sm font-medium px-3 py-1 rounded-full mb-6">
          Open Source · MIT License
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-6">
          AI Code Reviewer
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-400 mb-10 max-w-2xl mx-auto">
          AI-powered code review for GitHub PRs. Runs as a GitHub Actions step.
          Supports OpenAI, Anthropic, Gemini, and Ollama.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/ai-code-reviewer/getting-started"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
          >
            Get Started →
          </Link>
          <a
            href="https://github.com/giolabs/ai-code-reviewer"
            target="_blank"
            rel="noreferrer"
            className="border border-gray-300 dark:border-gray-700 hover:border-gray-400 font-semibold px-8 py-3 rounded-lg transition-colors"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Quick-start */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold mb-4 text-center">Add it in 2 minutes</h2>
        <p className="text-center text-gray-600 dark:text-gray-400 mb-6">
          Create <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">.github/workflows/ai-review.yml</code> in your repo:
        </p>
        <div className="relative bg-gray-900 dark:bg-gray-800 rounded-xl overflow-x-auto">
          <pre className="text-green-400 text-sm p-6 leading-relaxed">
            <code>{quickStartYaml}</code>
          </pre>
        </div>
        <p className="text-center text-gray-500 dark:text-gray-500 mt-4 text-sm">
          Add <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">OPENAI_API_KEY</code> to your repo secrets and you're done.{' '}
          <Link href="/ai-code-reviewer/getting-started" className="text-blue-600 dark:text-blue-400 hover:underline">
            Full setup guide →
          </Link>
        </p>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <h2 className="text-2xl font-bold mb-10 text-center">Everything you need</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="border border-gray-200 dark:border-gray-800 rounded-xl p-6 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 text-center text-sm text-gray-500 dark:text-gray-500">
        MIT License © Giolabs ·{' '}
        <a href="https://github.com/giolabs/ai-code-reviewer" className="hover:underline">
          GitHub
        </a>{' '}
        ·{' '}
        <a href="https://www.npmjs.com/package/@giolabsuy/ai-code-reviewer" className="hover:underline">
          npm
        </a>
      </footer>
    </div>
  )
}
