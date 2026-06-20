# README Beta Update

> **Status:** DRAFT

## 1. Goal

Update `README.md` to accurately reflect the current feature set before the beta release. Three groups of changes: (1) document multi-provider support (OpenAI, Anthropic, Gemini, Ollama) with a new `## Providers` section and inline fixes; (2) document the dependency graph context and risk report features; (3) remove or rewrite outdated copy that references OpenAI exclusively.

## 2. Scope

### Included in this phase

- Add two new bullets to `## Características`
- Add `## Providers` section after `## Quick start` documenting all four providers with API key names, default models, and local usage
- Update `## Quick start` step 2 to reference providers in general and link to the new Providers section
- Update `## Configuración` YAML example to show `provider` field before existing `model:` (currently missing; note: config key is `model`, not `providerModel`)
- Add a paragraph under `### review-pr` in `## Comandos CLI` describing the dependency graph and risk report behavior
- Update `## Uso local` to cover all four provider API keys
- Delete `## Costos` section entirely
- Rewrite the `¿Por qué OpenAI y no otro provider?` paragraph in `## Diseño y decisiones`
- Fix the `Características` bullet about structured output (currently claims `response_format: json_schema` for all providers — only true for OpenAI)

### Out of scope

- Changes to `src/cli.ts` — `EXAMPLE_CONFIG` already updated with multi-provider docs
- Changes to `src/` source files
- New workflow YAML examples per provider (Anthropic/Gemini/Ollama variants) — the Providers section links to each provider's console instead
- Pricing tables — section deleted per decision
- Changes to `examples/` directory
- Changes to `templates/`

## 3. Technologies & Project Conventions

### Stack

- `README.md` is plain GitHub-flavored markdown
- All prose is in **Spanish (rioplatense)** — no exceptions (CLAUDE.md rule)
- Code blocks, config keys, CLI flags, env var names, file paths: English (as today)

### Existing patterns to follow

- Section headers use `##` (H2) for top-level, `###` (H3) for sub-sections — match current README structure
- Code blocks use triple backticks with language hint (`yaml`, `bash`)
- Tables use `|---|---|` format consistent with the existing "Tech stacks" table
- Bullet items in `## Características` start with `**bold label**` followed by em dash and description

## 4. Prerequisites

- [x] Multi-provider implementation complete and merged (`src/llm/anthropic.ts`, `gemini.ts`, `ollama.ts`, `factory.ts`)
- [x] `DependencyGraphIndexer` implemented and merged (`src/dependency-indexer.ts`)
- [x] `anticipatedBugs` and `regressionRisks` fields implemented and merged (`src/types.ts`, all adapters)
- [x] `EXAMPLE_CONFIG` in `src/cli.ts` already documents `provider`, `providerModel`, and all four providers — no changes needed there

## 5. Architecture

### Pattern

Documentation-only change. Single file: `README.md` (290 lines currently). All modifications are additive (new section, new bullets, new paragraphs) plus two targeted rewrites (Costos deletion, OpenAI design paragraph rewrite).

### Layers affected

| Layer | Affected? | Description |
|---|---|---|
| `README.md` | **Yes** | All changes in this spec |
| `src/cli.ts` | No | `EXAMPLE_CONFIG` already correct |
| Any other file | No | |

### New README structure after changes

```
## Características           ← +2 new bullets
## Quick start               ← step 2 updated, link to Providers
## Providers                 ← NEW SECTION
## Configuración             ← +provider/providerModel in YAML example
## Tech stacks soportados    ← unchanged
## Comandos CLI              ← review-pr gets dependency graph paragraph
## Uso local                 ← updated for multi-provider env vars
~~## Costos~~                ← DELETED
## Diseño y decisiones       ← one paragraph rewritten
## Limitaciones conocidas    ← unchanged
## Desarrollo                ← unchanged
```

## 6. Files to Create / Modify

| Path | Action | Purpose | Example to follow |
|---|---|---|---|
| `README.md` | MODIFY | Apply all documentation updates | Current README structure and tone |

### Detail: all changes in `README.md`

#### A. `## Características` — add 2 new bullets

Insert after the existing `**Filtros**` bullet and before the `**Salida estructurada**` bullet:

```markdown
- **Grafo de dependencias en contexto** — en `review-pr`, analiza los imports y callers de los archivos del PR y los inyecta en el prompt del LLM para que tenga contexto estructural del proyecto (requiere stack JS/TS).
- **Reporte de bugs anticipados y riesgos de regresión** — además del code review, el modelo reporta bugs que probablemente surjan a futuro y archivos callers que pueden romperse con el cambio.
```

Fix the existing `**Salida estructurada**` bullet — current text is: `- **Salida estructurada** con \`response_format: json_schema\` de OpenAI (no parseo frágil).`. Rewrite to:

```markdown
- **Salida estructurada** — OpenAI usa `response_format: json_schema`; los demás providers reciben instrucciones de formato explícitas. En ningún caso se parsea texto libre del modelo.
```

#### B. `## Quick start` — update step 2

Current step 2 only mentions OpenAI. Replace with:

```markdown
### 2. Agregar tu API key

El provider por default es OpenAI. Agregá el secret en tu repo: **Settings → Secrets and variables → Actions → New repository secret**

- Nombre: `OPENAI_API_KEY`
- Valor: tu key de [platform.openai.com](https://platform.openai.com)

Para usar otro provider (Anthropic, Gemini, Ollama), mirá la sección [Providers](#providers).

(El `GITHUB_TOKEN` lo provee GitHub automáticamente.)
```

#### C. `## Providers` — new section (insert after `## Quick start`)

```markdown
## Providers

El reviewer soporta cuatro providers. Configurá el que preferís en `.ai-review.yml`:

```yaml
provider: openai          # openai | anthropic | gemini | ollama
model: gpt-4o-mini        # modelo específico del provider
```

| Provider | Secret de GitHub | Modelo default | Console |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com) |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | [console.anthropic.com](https://console.anthropic.com) |
| Gemini | `GEMINI_API_KEY` | `gemini-1.5-flash` | [aistudio.google.com](https://aistudio.google.com) |
| Ollama | _(sin key — self-hosted)_ | configurar en `model:` | [ollama.com](https://ollama.com) |

Para Anthropic, Gemini y Ollama el workflow de GitHub Actions es idéntico al de OpenAI — solo cambia el nombre del secret y el `provider` en el config:

```yaml
- run: npx -y ai-code-reviewer@latest review-pr
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Ollama** corre local y no necesita API key, pero requiere que el servicio esté corriendo y que configures la URL en `.ai-review.yml`:

```yaml
provider: ollama
model: codellama
ollamaUrl: http://localhost:11434   # default si se omite
```
```

#### D. `## Configuración` — add `provider` and `model` to the YAML example

The current YAML example starts with `# Modelo OpenAI` / `model: gpt-4o-mini`. The config key is `model` (not `providerModel`). Replace the existing `# Modelo OpenAI` comment and keep the `model:` key, adding a new `provider:` line above it:

```yaml
# LLM provider: openai | anthropic | gemini | ollama
provider: openai

# Modelo del provider. Ver sección Providers para opciones por provider.
model: gpt-4o-mini
```

Remove the comment `# Modelo OpenAI` (replace with the two blocks above).

#### E. `### review-pr` under `## Comandos CLI` — add dependency graph paragraph

After the existing description of `review-pr` and before the `**Opciones:**` list, insert:

```markdown
En stacks JS/TS, `review-pr` analiza automáticamente el grafo de dependencias de 1 nivel de los archivos cambiados — qué importan y qué los importa — y lo inyecta en el contexto del LLM. Esto permite al modelo detectar bugs anticipados y riesgos de regresión en callers que no forman parte del diff.

El resultado incluye dos secciones adicionales en el summary del PR (cuando son no vacías):
- **🐛 Bugs Anticipados** — bugs que probablemente surjan a futuro dado el cambio.
- **⚠️ Riesgos de Regresión** — archivos callers que pueden romperse.
```

#### F. `## Uso local` — update for multi-provider

Current section says `echo "OPENAI_API_KEY=sk-..." > .env`. Replace with:

```markdown
## Uso local

Para correr el reviewer localmente necesitás la API key del provider que uses. Lo más fácil es un `.env` en la raíz:

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
# ANTHROPIC_API_KEY=sk-ant-...

# Gemini
# GEMINI_API_KEY=AI...
```

`dotenv` lo carga automáticamente. Para Ollama no se necesita key — solo que el servicio esté corriendo en `http://localhost:11434` (o el URL que configures en `ollamaUrl`).

```bash
npx ai-code-reviewer review-file src/some-file.ts
```
```

#### G. `## Costos` — delete entirely

Remove the entire section from `## Costos` through the end of that section (before `## Diseño y decisiones`).

#### H. `## Diseño y decisiones` — rewrite one paragraph

Find and replace the paragraph starting with `**¿Por qué OpenAI y no otro provider?**`. Replace with:

```markdown
**¿Por qué multi-provider?**
Distintos equipos tienen distintos contratos, preferencias de privacidad y presupuestos. OpenAI es el default porque tiene la mejor relación calidad/costo para code review hoy, pero Anthropic, Gemini y Ollama son alternativas válidas. El CLI abstrae el provider en una interfaz común: cambiar de provider es un campo en `.ai-review.yml` y un secret en el repo, sin tocar el workflow.
```

## 7. API Contract

Sin API surface — documentación pura.

## 8. Success Criteria

- [ ] `README.md` renders correctamente en GitHub (verificar preview local con `grip` o abriendo en GitHub)
- [ ] La sección `## Providers` existe y tiene tabla con los 4 providers, nombres de secrets correctos, y modelos default actuales
- [ ] La sección `## Costos` no existe
- [ ] El párrafo `¿Por qué OpenAI y no otro provider?` no existe — reemplazado por `¿Por qué multi-provider?`
- [ ] Los bullets de grafo de dependencias y reporte de riesgos están en `## Características`
- [ ] El comando `review-pr` en `## Comandos CLI` describe el dependency graph y las secciones adicionales del summary
- [ ] `## Configuración` muestra `provider:` y `model:` (no `# Modelo OpenAI`)
- [ ] `## Uso local` cubre los 4 providers
- [ ] Todos los nombres de env vars son correctos: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (verificar contra `src/llm/anthropic.ts:12` y `src/llm/gemini.ts:12`)
- [ ] Todo el prose nuevo está en español rioplatense

### Verification commands

```bash
# Verificar que no queda ninguna referencia a "OpenAI" en contextos que deberían ser provider-agnostic
grep -n "OpenAI" README.md

# Verificar que la sección Costos no existe
grep -n "## Costos" README.md

# Verificar nombres de env vars contra la implementación
grep "ANTHROPIC_API_KEY\|GEMINI_API_KEY\|OPENAI_API_KEY" src/llm/*.ts
```

### Tests required

No aplica — cambio de documentación. Verificación manual del render en GitHub o con un previewer local.

## 9. UX Criteria

Not applicable — documentation only.

## 10. Decisions Made (Locked)

- **Quick Start usa OpenAI + link a sección Providers** — mantiene el flow de Quick Start corto y lineal para el caso más común. Los usuarios de otros providers tienen una ruta clara.
- **Sección `## Costos` eliminada** — los precios de todos los providers cambian con frecuencia. Cualquier tabla quedaría desactualizada en semanas. Los usuarios consultan precios directamente en cada console.
- **Bullets en Características + párrafo en review-pr para dependency graph** — no amerita sección propia; es una feature interna de `review-pr`, no algo que el usuario configure.
- **Párrafo `¿Por qué OpenAI?` reescrito, no eliminado** — la sección de diseño es valiosa; el párrafo se adapta en lugar de borrarse.
- **`EXAMPLE_CONFIG` en `cli.ts` no se toca** — ya está correcto y completo con multi-provider.

## 11. Edge Cases

- El link de ancla `[Providers](#providers)` en Quick Start step 2 — verificar que el ancla funciona en GitHub Markdown (GitHub normaliza `## Providers` a `#providers`)
- El bloque de código YAML anidado dentro del bloque de la sección `## Providers` — usar sangría o cerrar y reabrir el bloque si el render falla

## 12. Required UI States

Not applicable.

## 13. Validations

Not applicable.

## 14. Security & Permissions

- No incluir API keys reales en el README (obvio, pero verificar que ningún ejemplo tenga keys hardcodeadas)
- Los nombres de secrets (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) deben coincidir exactamente con los que lee el código (`src/llm/openai.ts:116`, `src/llm/anthropic.ts:12`, `src/llm/gemini.ts:12`)

## 15. Observability & Logging

Not applicable.

## 16. i18n / User-facing copy

Todo el prose nuevo en español rioplatense. Strings de referencia para el implementador:

| Contexto | String |
|---|---|
| Características bullet 1 | `Grafo de dependencias en contexto` |
| Características bullet 2 | `Reporte de bugs anticipados y riesgos de regresión` |
| Quick Start step 2 header | `Agregar tu API key` |
| Nueva sección header | `Providers` |
| review-pr dependency paragraph opener | `En stacks JS/TS, \`review-pr\` analiza automáticamente...` |
| Uso local header | `Uso local` (unchanged) |
| Diseño paragraph header | `¿Por qué multi-provider?` |

## 17. Performance

Not applicable.

## 18. Restrictions

- No agregar pricing estimado para ningún provider — la sección Costos se elimina; no reemplazar por otra tabla de precios
- No cambiar el orden existente de secciones más allá de lo especificado en la nueva estructura del punto 5
- No modificar `src/cli.ts` — `EXAMPLE_CONFIG` ya está correcto
- No agregar ejemplos de workflow YAML por separado para Anthropic/Gemini/Ollama en el Quick Start — el bloque minimal en la sección Providers es suficiente
- No tocar el español de las secciones que no se mencionan en este spec

## 19. Deliverables

- [ ] `README.md` actualizado con todos los cambios descritos en la sección 6
- [ ] Verificación manual: sección Providers renderiza correctamente en GitHub Markdown
- [ ] Verificación: `grep -n "## Costos" README.md` devuelve vacío
- [ ] Verificación: todos los env var names coinciden con el código fuente

## 20. Final Agent Checklist

- [ ] Leer el spec completo antes de editar el README
- [ ] Verificar nombres exactos de env vars contra `src/llm/openai.ts:116`, `src/llm/anthropic.ts:12`, `src/llm/gemini.ts:12`
- [ ] Verificar que el ancla `#providers` funciona (sección se llama `## Providers`)
- [ ] Prose nuevo en español rioplatense — no inglés
- [ ] No tocar `src/cli.ts`
- [ ] No agregar pricing
- [ ] No cambiar el orden de secciones más allá del spec
- [ ] `grep -n "## Costos" README.md` → vacío
- [ ] `grep -n "Por qué OpenAI" README.md` → vacío
- [ ] `grep -n "## Providers" README.md` → línea encontrada
