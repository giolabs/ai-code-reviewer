# Security Policy

## Supported versions

| Version | Security fixes |
|---------|---------------|
| `0.1.0-beta.*` | Yes |
| `< 0.1.0` | No |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private security advisory to report vulnerabilities confidentially:

1. Go to [Security → Advisories](https://github.com/giolabs/ai-code-reviewer/security/advisories)
2. Click **"Report a vulnerability"**
3. Fill in the form with a description, steps to reproduce, and the potential impact

You will receive an acknowledgement within **48 hours**. We aim to release a patch within:

- **Critical** (CVSS ≥ 9.0): 14 days
- **High** (CVSS 7.0–8.9): 21 days
- **Medium / Low**: 30 days

## Scope

The following are considered in-scope vulnerabilities for this project:

- Prompt injection via user-controlled config (`.ai-review.yml`, `rules` file) that causes the reviewer to post malicious content to GitHub
- Exposure of API keys or `GITHUB_TOKEN` through logs, error messages, or generated output
- Remote code execution triggered by processing a malicious `git diff` or file content
- Privilege escalation via the `GITHUB_TOKEN` permissions used by the workflow

## Out of scope

- Bugs in third-party LLM providers (OpenAI, Anthropic, Gemini, Ollama) — report those to the respective vendor
- Theoretical attacks with no demonstrated exploit path
- Issues requiring physical access to the runner machine
- Social engineering attacks against maintainers
