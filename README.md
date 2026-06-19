# ai-code-reviewer

> AI-powered code review para Pull Requests de GitHub, configurable por proyecto y tech stack. Pensado para correr como step en GitHub Actions.

Conectá tu repo, definí tus reglas, y dejá que un Senior reviewer impulsado por OpenAI revise cada PR con inline comments y un summary general.

---

## Características

- **Plug & play en GitHub Actions** — un job de YAML y listo.
- **Reglas configurables por proyecto** — archivo `.ai-review.yml` + opcional `code-review-rules.md` con prompts específicos del equipo.
- **Auto-detección de tech stack** (NestJS, React, Next.js, TypeScript, Node, Flutter, Laravel) con templates de reglas built-in para cada uno.
- **Inline comments + summary** en el PR, con severidad codificada por color.
- **Comandos locales** (`review-file`, `review-diff`) para iterar sobre las reglas sin abrir un PR.
- **Filtros**: severidad mínima, archivos ignorados, tamaño máximo, categorías de checks.
- **Salida estructurada** con `response_format: json_schema` de OpenAI (no parseo frágil).

---

## Quick start

### 1. Agregar el workflow

Creá `.github/workflows/ai-review.yml` en tu repo:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx -y ai-code-reviewer@latest review-pr
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 2. Agregar tu API key

En tu repo: **Settings → Secrets and variables → Actions → New repository secret**

- Nombre: `OPENAI_API_KEY`
- Valor: tu key de [platform.openai.com](https://platform.openai.com)

(El `GITHUB_TOKEN` lo provee GitHub automáticamente.)

### 3. (Opcional) Configurar reglas del proyecto

```bash
npx ai-code-reviewer init
```

Eso crea `.ai-review.yml` con todos los defaults documentados. Editalo a gusto.

### 4. Abrir un PR

El próximo PR que abras dispara el workflow. El bot deja inline comments en las líneas con findings y un summary general.

---

## Configuración

El archivo `.ai-review.yml` (o `.ai-review.json`) en la raíz de tu repo controla el comportamiento. Acá están todas las opciones con sus defaults:

```yaml
# Modelo OpenAI
model: gpt-4o-mini

# Idioma del review: es | en
language: es

# Tech stack. Omitir para auto-detectar desde package.json
# tech: nestjs

# Reglas custom adicionales (markdown). Se concatenan al system prompt.
# rules: ./code-review-rules.md

# Globs de archivos a ignorar
ignore:
  - node_modules/**
  - dist/**
  - "*.lock"
  - "*.min.js"

# Severidad mínima: critical | major | minor | info | nitpick
minSeverity: minor

# Tamaño máximo de patch por archivo (bytes)
maxFileSize: 100000

# Categorías de checks habilitadas
checks:
  security: true
  performance: true
  maintainability: true
  testing: true
  documentation: false
  style: false
  bug-risk: true
  architecture: true

# Comportamiento de posteo
inlineComments: true
summaryComment: true
maxInlineComments: 20

# Prompt extra que se agrega al system prompt
customInstructions: |
  Este proyecto sigue Clean Architecture. Cualquier import de capa de
  dominio hacia infraestructura es un finding 'major'.
```

### Reglas custom extensas

Para reglas más largas, mantenelas en un archivo aparte y referencialo:

```yaml
rules: ./code-review-rules.md
```

Ese markdown se concatena al system prompt completo. Es útil para listar convenciones del equipo, patrones obligatorios/prohibidos, y excepciones aceptadas.

Mirá `examples/code-review-rules.md` para una plantilla.

---

## Tech stacks soportados (built-in)

El reviewer carga automáticamente un set de reglas según el stack detectado. Los detectables hoy son:

| Stack | Detección |
|---|---|
| **NestJS** | `@nestjs/core` en `package.json` |
| **Next.js** | `next` en `package.json` |
| **React** | `react` en `package.json` |
| **TypeScript** | `typescript` en `package.json` |
| **Node** | `package.json` sin los anteriores |
| **Flutter** | `pubspec.yaml` |
| **Laravel** | `composer.json` |
| **Generic** | Fallback |

Las reglas built-in viven en [`templates/`](./templates) y se pueden inspeccionar en el repo. Si tus reglas custom contradicen una built-in, las tuyas ganan.

---

## Comandos CLI

### `review-pr`

Modo principal: corre dentro de GitHub Actions sobre el PR actual.

```bash
npx ai-code-reviewer review-pr [opciones]
```

Detecta el PR desde `GITHUB_EVENT_PATH`, obtiene los archivos cambiados vía API, llama a OpenAI, y postea el review con summary + inline comments.

**Opciones:**
- `--dry-run` — no postea al PR, solo imprime el resultado.
- `--save <path>` — guarda un report markdown en el path indicado.
- `-c, --config <path>` — config alternativo.
- `-r, --rules <path>` — reglas custom alternativas.
- `-m, --model <model>` — override del modelo.
- `-l, --language <es|en>` — override del idioma.
- `-t, --tech <stack>` — forzar tech stack.

**Exit codes:**
- `0` — review posteado, recomendación `approve` o `comment`.
- `1` — review posteado con recomendación `request_changes`, o error.

### `review-file <file>`

Revisa un archivo local sin tocar git ni PR. Útil para iterar sobre las reglas.

```bash
npx ai-code-reviewer review-file src/users/users.service.ts
```

### `review-diff`

Revisa el output de `git diff` localmente.

```bash
# Working tree vs HEAD
npx ai-code-reviewer review-diff

# Solo staged
npx ai-code-reviewer review-diff --staged

# Contra una branch base
npx ai-code-reviewer review-diff --base main
```

Útil como pre-commit hook o para sanity check antes de pushear.

### `init`

Crea `.ai-review.yml` con todos los defaults documentados.

```bash
npx ai-code-reviewer init
```

---

## Uso local

Para correr el reviewer localmente necesitás `OPENAI_API_KEY` en el environment. Lo más fácil es un `.env` en la raíz:

```bash
echo "OPENAI_API_KEY=sk-..." > .env
npx ai-code-reviewer review-file src/some-file.ts
```

`dotenv` lo carga automáticamente.

---

## Costos

Por default usa `gpt-4o-mini`, que es barato (cents por review en PRs típicos). Si querés mejor calidad cambialo a `gpt-4o` en el config, sabiendo que cuesta ~10x más por token.

El comando imprime el conteo de tokens al final para trackear.

---

## Diseño y decisiones

**¿Por qué un CLI que corre en Actions y no una GitHub App?**
Las Apps requieren infra propia (servidor, webhooks, gestión de tokens). Un CLI vía `npx` corre en el runner del cliente, no requiere mantener infra, y el código del bot es completamente auditable por el equipo que lo usa.

**¿Por qué OpenAI y no otro provider?**
Lo pidió el usuario. Sustituir el provider es un cambio chico en `src/openai.ts` (cambiar el cliente y el schema de response_format).

**¿Por qué nunca se aprueba automáticamente?**
Aunque el modelo devuelva `approve` en su recomendación, el review se postea como `COMMENT` o `REQUEST_CHANGES`. Aprobar PRs sigue siendo decisión humana.

**¿Por qué inline comments + summary y no solo un comment grande?**
Los inline comments aparecen en el lugar relevante del PR, lo que reduce mucho la fricción de mirar lo que el bot está señalando. El summary cubre los findings que no se mapean a líneas del diff.

---

## Limitaciones conocidas

- **Solo eventos `pull_request` / `pull_request_target`.** No soporta `push` directo a una branch.
- **Diffs gigantes se truncan.** PRs con miles de líneas cambiadas pueden no caber en el context window; el modelo solo verá una parte. Apuntá a PRs chicos (te lo agradece tu reviewer humano también).
- **Inline comments solo en líneas del diff.** GitHub no permite comentar en líneas no tocadas. Findings sobre líneas fuera del diff caen en el summary.
- **No mantiene memoria entre PRs.** Cada review es independiente.

---

## Desarrollo

```bash
git clone https://github.com/giolabs/ai-code-reviewer
cd ai-code-reviewer
npm install
npm run build
```

Para probar sin publicar:

```bash
# En el repo del reviewer
npm link

# En el repo a revisar
npm link ai-code-reviewer
ai-code-reviewer review-file src/some-file.ts
```

---

## Licencia

MIT
