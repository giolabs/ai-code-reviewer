# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

All code must be written in **English** without exception: class names, method names, variable names, interface names, enum values, type aliases, file names, inline comments, and commit messages. The only content permitted in Spanish is user-facing CLI output and the README, which are intentionally in Spanish (rioplatense) for end users.

## Spec First

Before implementing any new feature or significant change, always generate a spec using `/generate-spec`. The resulting spec file must be saved under `docs/` with a descriptive kebab-case name (e.g., `docs/inline-comment-grouping.md`). No implementation starts until the spec exists and has been reviewed.

## What This Is

AI-powered code reviewer CLI for GitHub PRs. Runs as a GitHub Actions step via `npx ai-code-reviewer@latest review-pr`, or locally via `review-file` and `review-diff` commands. Uses OpenAI structured output (`response_format: json_schema`) to produce typed review results. Written in Spanish (rioplatense) — README, comments, CLI output, and the default review language are all in Spanish.

## Build & Run

```bash
npm install
npm run build          # tsc → dist/
npm run dev            # tsx src/cli.ts (no compile step)
npm run clean          # rm -rf dist
```

There are no tests. There is no linter configured.

To test locally, set `OPENAI_API_KEY` in a `.env` file or environment, then:

```bash
npm run dev -- review-file src/some-file.ts
npm run dev -- review-diff --staged
npm run dev -- review-diff --base main
npm run dev -- review-pr --dry-run   # only works in GitHub Actions context
```

## Architecture

The pipeline is: **CLI → config resolution → tech detection → prompt assembly → OpenAI call → output/post**.

### Source files (`src/`)

- **cli.ts** — Commander-based CLI entry point. Defines `review-pr`, `review-file`, `review-diff`, and `init` commands. Also contains the `EXAMPLE_CONFIG` template string for `init`.
- **reviewer.ts** — Orchestrator. Each command (`reviewPullRequest`, `reviewSingleFile`, `reviewLocalDiff`) follows the same flow: resolve config → detect tech → build prompts → call OpenAI → filter/format output. Contains `parseLocalDiff()` for parsing raw `git diff` output into `ChangedFile[]`.
- **config.ts** — Loads `.ai-review.yml` (or `.json` variants) merged over `DEFAULT_CONFIG`. Also loads built-in tech templates from `templates/` and user-provided rules markdown. Contains the glob-matching implementation for ignore patterns.
- **tech-detect.ts** — Detects project tech stack from `package.json` deps or marker files (`pubspec.yaml`, `composer.json`). Order matters: more specific stacks first (Next.js before React, NestJS before Node).
- **prompts.ts** — Builds the system prompt (role, tech rules, check categories, severity scale, language) and user prompt (PR metadata + file diffs with truncation at 80k chars).
- **openai.ts** — Thin wrapper around `OpenAI.chat.completions.create` with `json_schema` response format. The `REVIEW_SCHEMA` constant defines the strict JSON schema the model must follow. Returns typed `ReviewResult`.
- **github.ts** — Octokit-based GitHub API integration: reads PR context from `GITHUB_EVENT_PATH` env vars, fetches changed files, posts reviews with inline comments. `buildDiffLineMap()` parses unified diffs to determine which lines are commentable. `postReview()` splits findings into inline comments (on diff lines) vs orphans (appended to summary).
- **output.ts** — Terminal pretty-printing with chalk and markdown report generation. Severity filtering and sorting logic lives here.
- **types.ts** — All shared types: `Severity`, `CheckCategory`, `TechStack`, `ReviewerConfig`, `ReviewFinding`, `ReviewResult`, `ChangedFile`, `PullRequestContext`.

### Key design decisions

- **Never auto-approves**: `mapRecommendationToEvent()` in `reviewer.ts` downgrades `approve` → `COMMENT`. Human approval only.
- **Structured output over parsing**: Uses OpenAI's `json_schema` response format so the model is constrained to valid output — no regex/string parsing of LLM responses.
- **Custom rules override built-in**: User's `code-review-rules.md` is appended after built-in tech template in the system prompt, so it wins on conflicts.
- **Exit code 1 on `request_changes`**: Allows CI pipelines to fail the job when the reviewer flags serious issues.

### Templates (`templates/`)

Markdown files with review rules per tech stack: `nestjs-rules.md`, `nextjs-rules.md`, `react-rules.md`, `typescript-rules.md`, `node-rules.md`, `flutter-rules.md`, `laravel-rules.md`, `generic-rules.md`. Loaded by `config.ts:loadBuiltinTemplate()`.

## Environment Variables

- `OPENAI_API_KEY` — Required for all review commands.
- `GITHUB_TOKEN` — Required for `review-pr` (provided automatically by GitHub Actions).
- `GITHUB_REPOSITORY`, `GITHUB_EVENT_PATH` — Read by `github.ts` to detect PR context in Actions.
- `DEBUG` — When set, prints full stack traces on error.

## ESM Module

This is an ESM package (`"type": "module"`). All internal imports use `.js` extensions (even for `.ts` source files). TypeScript is configured with `moduleResolution: "Bundler"` and target `ES2022`.

## TypeScript Coding Standards

These rules are mandatory and apply to every file written or modified in this project. No exceptions.

### Prohibiciones absolutas

- **Prohibido `any` y `unknown`**: Nunca usar `any` ni `unknown` como tipo de variable, parámetro, retorno o genérico. Si el tipo no se conoce, crear un `Type`, `Interface` o `enum` que lo modele explícitamente. Si viene de una API externa o librería sin tipos, crear un tipo wrapper que describa la estructura esperada.
- **Prohibido parámetros separados en funciones**: Ninguna función o método puede recibir parámetros posicionales separados. Todos los parámetros se agrupan en un único objeto tipado con una `interface` declarada explícitamente. Excepción: callbacks simples de un solo argumento primitivo (`id: string`, `index: number`) cuando el contexto lo hace inequívoco.
- **Prohibidas las funciones sueltas**: No declarar `function foo()` ni `const foo = () => {}` en el scope de módulo. Toda lógica vive dentro de una clase. Las únicas excepciones son hooks de React/framework (nombrados con prefijo `use`) y los entry points de CLI (el `main` mínimo que instancia la clase y la llama).

### Tipado

- **Siempre clases**: Toda unidad de lógica es una clase. Usar `class` en lugar de objetos literales con métodos o módulos de funciones.
- **`Partial<T>` para validación parcial**: Cuando un método o constructor acepta un subconjunto opcional de propiedades de una interfaz, usar `Partial<T>` o `Partial<T> & Pick<T, 'campo'>` en lugar de repetir propiedades opcionales manualmente.
- **`Readonly<T>` para datos inmutables**: Propiedades que no se modifican después de la construcción deben declararse `readonly`. Arrays que no se mutan son `ReadonlyArray<T>`.
- **Tipos de retorno explícitos**: Todo método de clase debe declarar su tipo de retorno explícitamente. No confiar en la inferencia para la firma pública de un método.
- **Genéricos con restricción**: Nunca `<T>` sin restricción cuando el tipo tiene forma conocida. Usar `<T extends MiInterface>` para acotar el contrato.
- **Union types sobre booleanos de control**: En lugar de `isActive: boolean`, modelar estados con union: `status: 'active' | 'inactive' | 'pending'`. Cuando el dominio crece, promover a `enum`.
- **`enum` para conjuntos cerrados de valores**: Valores constantes relacionados que representan un dominio (severidades, estados, categorías) deben ser `enum`, no strings literales dispersos.
- **`interface` para contratos, `type` para alias y uniones**: Usar `interface` cuando se define la forma de un objeto que puede ser implementado o extendido. Usar `type` para alias de uniones, intersecciones o tipos utilitarios.
- **Sin type assertions `as X` salvo en test setup o guards**: El cast `as Tipo` enmascara errores. Si se necesita, es señal de que el tipo origen está mal modelado. Refactorizar el origen. Única excepción permitida: guards de tipo narrowing (`as never` en exhaustive checks) y fixtures de test.

### Estructura de código

- **Una clase por archivo**: Cada archivo exporta una sola clase principal. Tipos, interfaces y enums auxiliares de ese archivo pueden coexistir en el mismo archivo.
- **Inyección de dependencias por constructor**: Las dependencias de una clase se reciben por constructor y se almacenan como `private readonly`. No instanciar dependencias dentro de métodos.
- **Métodos pequeños y con nombre de intención**: Un método hace una sola cosa. Si supera ~20 líneas, extraer lógica a métodos privados con nombres que describan la intención.
- **No mutación de parámetros**: Los parámetros recibidos no se modifican. Si se necesita transformar, crear una nueva variable con el resultado.
- **`async/await` sobre callbacks y `.then()`**: Toda asincronía usa `async/await`. Los errores se manejan con `try/catch` tipado (el `catch (e)` debe castear a un tipo concreto o usar un guard, nunca dejar `e` como `unknown` sin narrowing).

### Ejemplo de patrón correcto (tipado)

```typescript
// ✅ Correcto
interface ReviewOptions {
  filePath: string;
  maxTokens: number;
  language?: string;
}

interface ReviewOutput {
  findings: ReviewFinding[];
  recommendation: Recommendation;
}

class FileReviewer {
  constructor(
    private readonly openaiClient: OpenAIClient,
    private readonly config: ReviewerConfig,
  ) {}

  async review(options: ReviewOptions): Promise<ReviewOutput> {
    const prompt = this.buildPrompt(options);
    return this.openaiClient.call(prompt);
  }

  private buildPrompt(options: ReviewOptions): string {
    // ...
  }
}

// ❌ Incorrecto — ninguno de estos patrones está permitido
function reviewFile(path: string, tokens: number, lang?: string): any { }
const process = (data: unknown) => { };
class Foo { bar(a: string, b: number, c: boolean) { } }
```

## Testing con Vitest

### Setup

Usar **Vitest** como único framework de testing. Configurar en `vitest.config.ts` en la raíz. Instalar con `npm install -D vitest`.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

Agregar script en `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

### Reglas de testing

**Patrón AAA obligatorio**: Todo test sigue exactamente tres bloques comentados: `// Arrange`, `// Act`, `// Assert`. Sin excepciones. Si un test no tiene los tres bloques claramente separados, está mal estructurado.

**Archivos cortos**: Un archivo de test cubre una sola clase. Si el archivo supera ~100 líneas, está haciendo demasiado — partir por responsabilidad o extraer helpers. Nunca agrupar tests de múltiples clases en un mismo archivo.

**Casos de uso que aporten**: Cada `it()` testea un comportamiento observable del dominio, no un detalle de implementación. El nombre del test completa la frase: *"debe [hacer algo concreto] cuando [condición]"*. Si el nombre no describe un escenario del negocio, el test no aporta.

**Sin complejidad dentro del test**: Cero lógica condicional (`if`, `switch`, loops) dentro de un `it()`. Si se necesita variar inputs, usar `it.each()`. Si el setup es complejo, moverlo a `beforeEach` o a una función factory local del archivo.

**Mocks mínimos y explícitos**: Mockear solo lo que cruza un límite real (red, disco, API externa). No mockear clases propias del dominio — instanciarlas directamente. Los mocks se declaran con `vi.fn()` tipados con la interfaz real: `vi.fn<MiInterface['metodo']>()`.

**Un assert conceptual por test**: Un `it()` verifica una sola cosa. Múltiples `expect()` están permitidos solo cuando todos verifican facetas del mismo resultado (e.g., un objeto con varios campos). Si cada `expect()` verifica algo diferente, partir en tests separados.

**Sin setup global compartido entre describes**: El estado compartido entre tests genera orden-dependencia y tests frágiles. Usar `beforeEach` dentro del `describe` correspondiente, nunca variables mutables en el scope del módulo.

### Estructura de archivos

Los tests **nunca** van junto a los archivos de implementación. Siempre en una carpeta `__test__` en la raíz del proyecto, replicando la estructura de `src/`.

```
src/
  reviewer.ts
  config.ts
  github.ts
__test__/
  reviewer.test.ts
  config.test.ts
  github.test.ts
```

Actualizar `vitest.config.ts` para que apunte a esa carpeta:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__test__/**/*.test.ts'],
  },
});
```

### Ejemplo de patrón correcto (testing)

```typescript
// reviewer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileReviewer } from './reviewer.js';

// Factory local — oculta el ruido de construcción del objeto
function makeReviewer(overrides: Partial<ReviewerConfig> = {}): FileReviewer {
  const config: ReviewerConfig = { language: 'es', maxTokens: 1000, ...overrides };
  const openaiClient = { call: vi.fn<OpenAIClient['call']>() };
  return new FileReviewer(openaiClient, config);
}

describe('FileReviewer', () => {
  describe('review', () => {
    it('debe retornar findings cuando el modelo detecta problemas', async () => {
      // Arrange
      const reviewer = makeReviewer();
      const expectedFindings: ReviewFinding[] = [
        { severity: Severity.HIGH, message: 'Variable no tipada', file: 'foo.ts', line: 3 },
      ];
      vi.mocked(reviewer['openaiClient'].call).mockResolvedValueOnce({
        findings: expectedFindings,
        recommendation: 'request_changes',
      });

      // Act
      const result = await reviewer.review({ filePath: 'foo.ts', maxTokens: 1000 });

      // Assert
      expect(result.findings).toEqual(expectedFindings);
    });

    it('debe retornar lista vacía cuando no hay problemas', async () => {
      // Arrange
      const reviewer = makeReviewer();
      vi.mocked(reviewer['openaiClient'].call).mockResolvedValueOnce({
        findings: [],
        recommendation: 'comment',
      });

      // Act
      const result = await reviewer.review({ filePath: 'clean.ts', maxTokens: 1000 });

      // Assert
      expect(result.findings).toHaveLength(0);
    });
  });
});

// ❌ Incorrecto — estos patrones no están permitidos
it('test 1', () => {
  const r = new FileReviewer(x, y);
  if (condition) { expect(r.foo()).toBe(1); } // lógica dentro del test
});

it('verifica todo', async () => {
  expect(result.a).toBe(1);  // assert mezclado — partir en tests separados
  expect(result.b).toBe(2);
  expect(result.c).toBe(3);
});
```
