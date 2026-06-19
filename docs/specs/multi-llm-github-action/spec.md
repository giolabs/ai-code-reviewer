# Multi-LLM GitHub Action con Sistema de Reglas Jerarquico

> **Estado:** DRAFT

## 1. Objetivo

Transformar `ai-code-reviewer` de un CLI que se corre manualmente via `npx` en GitHub Actions a una **GitHub Action reutilizable** (`uses: giolabs/ai-code-reviewer@v1`) con soporte para multiples proveedores de LLM (OpenAI, Anthropic Claude, Google Gemini, Ollama) mediante un patron Adapter, y un sistema de reglas jerarquico donde las reglas del proyecto tienen prioridad sobre las globales con merge a nivel de categoria.

## 2. Alcance

### Incluido en esta fase

- Refactor del modulo OpenAI a un patron Adapter con clase abstracta `LLMAdapter`
- Implementacion de 4 adapters: OpenAI, Anthropic, Gemini, Ollama
- Router/factory que selecciona el adapter segun configuracion
- Sistema de merge de reglas por categoria (proyecto > global)
- Publicacion como GitHub Action reutilizable con `action.yml`
- Entry point dedicado para el Action (`src/action.ts`)
- Estructura de comentarios de PR estandarizada (formato global fijo)
- Actualizacion del schema de configuracion `.ai-review.yml` con campos `provider`, `providerModel`, `ollamaUrl`
- Backward compatibility: el CLI sigue funcionando, OpenAI es el default

### Fuera de scope

- Dashboard o UI web -- no hay interfaz visual en esta fase
- GitHub App con webhook server, OAuth, o Marketplace -- se distribuye como Action
- Base de datos o persistencia server-side -- todo es file-based
- Formato de comentarios configurable por proyecto -- formato fijo global
- Streaming de respuestas del LLM
- Soporte para providers adicionales mas alla de los 4 definidos
- Tests (se definen en esta spec pero se implementan en una fase posterior)
- Linter o CI pipeline del propio proyecto

## 3. Tecnologias y convenciones del proyecto

### Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Runtime**: Node.js >= 18
- **CLI framework**: Commander
- **HTTP/API clients**: `openai` SDK, `@anthropic-ai/sdk`, `@google/generative-ai`, fetch nativo (Ollama)
- **GitHub API**: `@octokit/rest`
- **Config**: js-yaml para `.ai-review.yml`
- **Output**: chalk para terminal
- **Module resolution**: Bundler (tsconfig `moduleResolution: "Bundler"`)

### Versiones relevantes

| Dependency | Version | Source |
|---|---|---|
| typescript | ^5.6.0 | `package.json` line 50 |
| openai | ^4.67.0 | `package.json` line 44 |
| @octokit/rest | ^21.0.0 | `package.json` line 39 |
| commander | ^12.1.0 | `package.json` line 41 |
| js-yaml | ^4.1.0 | `package.json` line 43 |
| chalk | ^5.3.0 | `package.json` line 40 |
| node | >=18.0.0 | `package.json` line 37 |
| @anthropic-ai/sdk | ^0.39.0 | NUEVO — adapter Anthropic |
| @google/generative-ai | ^0.21.0 | NUEVO — adapter Gemini |
| @actions/core | ^1.11.0 | NUEVO — GitHub Action logging y outputs |

### Patrones existentes a respetar

- Imports con extension `.js` aunque el source sea `.ts` (ESM convention)
- El proyecto actual usa funciones puras. Los LLM adapters se implementan con OOP (clases) para encapsular el estado del SDK client. El resto de los modulos nuevos (`rules.ts`, `action.ts`, `json-parser.ts`) siguen con funciones exportadas, no clases
- Config mergeada sobre `DEFAULT_CONFIG` en `src/config.ts`
- Structured output via JSON schema en la llamada al LLM
- Comentarios y mensajes de CLI en espanol rioplatense

## 4. Dependencias previas

- [ ] Cuenta activa en OpenAI con API key (ya existente)
- [ ] Cuenta en Anthropic con API key para testeo del adapter Claude
- [ ] Cuenta en Google AI Studio con API key para testeo del adapter Gemini
- [ ] Ollama instalado localmente para testeo del adapter Ollama
- [ ] Repositorio publicado en GitHub (para testear la Action)

## 5. Arquitectura

### Patron

Adapter pattern con OOP para LLM providers + Factory para instanciacion + Strategy para merge de reglas. Cada provider es una clase que implementa la clase abstracta `LLMAdapter`. La factory instancia la clase correcta segun el provider configurado.

### Capas afectadas

| Layer | Affected? | Description |
|---|---|---|
| LLM adapters (nuevo) | Si | Nueva capa `src/llm/` con interfaz + 4 implementaciones |
| Config | Si | Nuevos campos `provider`, `providerModel`, `ollamaUrl` en ReviewerConfig |
| Rules engine (nuevo) | Si | Nuevo modulo `src/rules.ts` para merge jerarquico de reglas |
| Prompts | Si | Refactor para recibir reglas ya mergeadas en vez de cargar templates directamente |
| Reviewer (orchestrator) | Si | Reemplazar llamada directa a `openai.ts` por el router de LLM |
| GitHub integration | Si | Actualizar formato de comentarios al nuevo estandar fijo |
| CLI | Si | Nuevo entry point `src/action.ts` + agregar opcion `--provider` al CLI |
| Output | Si | Actualizar formato de summary y inline comments |
| Types | Si | Nuevos tipos para LLM adapter, provider config, merged rules |
| Tech detect | No | Sin cambios |

### Flujo esperado

1. GitHub Action trigger: PR abierto/actualizado dispara el workflow
2. `action.ts` lee inputs del Action (overrides opcionales) y env vars (API keys desde GitHub Secrets)
3. `reviewer.ts` carga `.ai-review.yml` del repo — ahi el proyecto define `provider`, `model`, y demas opciones
4. Se resuelve la config final: `.ai-review.yml` del repo como base, con override de inputs del Action si los hay
5. `rules.ts` carga reglas del proyecto + reglas globales, las mergea por categoria
6. `prompts.ts` construye system prompt con las reglas mergeadas
7. LLM factory (`src/llm/factory.ts`) instancia el adapter del provider configurado en `.ai-review.yml`
8. El adapter lee su API key de `process.env` (GitHub Secret) — la key NO esta en la config, solo el provider
9. El adapter llama al LLM, parsea la respuesta JSON y devuelve `ReviewResult`
10. `github.ts` postea el review con el formato estandarizado

### Configuracion por proyecto — ejemplos

Cada empresa/desarrollador configura **que LLM usar** en el `.ai-review.yml` de su repo. La API key la configura como GitHub Secret en su repo u organizacion.

**Ejemplo 1 — Empresa que usa Anthropic Claude:**

`.ai-review.yml` en el repo:
```yaml
provider: anthropic
model: claude-sonnet-4-5-20250514
language: en
minSeverity: minor
```

`.github/workflows/ai-review.yml`:
```yaml
- uses: giolabs/ai-code-reviewer@v1
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Ejemplo 2 — Startup que usa OpenAI (default, config minima):**

`.ai-review.yml` en el repo:
```yaml
# provider: openai (default, no hace falta ponerlo)
model: gpt-4o
language: es
```

`.github/workflows/ai-review.yml`:
```yaml
- uses: giolabs/ai-code-reviewer@v1
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Ejemplo 3 — Equipo con datos sensibles que usa Ollama (LLM local en self-hosted runner):**

`.ai-review.yml` en el repo:
```yaml
provider: ollama
model: llama3.1
ollamaUrl: http://localhost:11434
language: es
```

`.github/workflows/ai-review.yml` (self-hosted runner con Ollama instalado):
```yaml
- uses: giolabs/ai-code-reviewer@v1
  # No necesita API key — Ollama corre local
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Ejemplo 4 — Organizacion que configura el secret a nivel org:**

El secret `GEMINI_API_KEY` se configura una sola vez en **Organization → Settings → Secrets → Actions**, y todos los repos de la org lo heredan.

`.ai-review.yml` en cada repo:
```yaml
provider: gemini
model: gemini-2.0-flash
```

**Nota:** en todos los ejemplos se usa `model:` por simplicidad. Tambien se puede usar `providerModel:` que es equivalente; si ambos estan presentes, `providerModel` toma precedencia (ver seccion 10, decisiones tomadas).

**Resumen del circuito:**
- **Que LLM usar** → `.ai-review.yml` en el repo (commiteable, versionable, sin datos sensibles)
- **Con que credencial** → GitHub Secret en el repo u organizacion (seguro, nunca en codigo)

### Layout de archivos nuevos

```
src/
  llm/
    types.ts          # LLMAdapter abstract class, LLMConfig, ProviderName type
    factory.ts        # createLLMAdapter(provider, config) => LLMAdapter
    openai.ts         # OpenAI adapter (refactor del actual src/openai.ts)
    anthropic.ts      # Anthropic/Claude adapter
    gemini.ts         # Google Gemini adapter
    ollama.ts         # Ollama adapter
    json-parser.ts    # Parsing JSON con retry para providers sin json_schema nativo
  rules.ts            # Merge jerarquico de reglas por categoria
  action.ts           # Entry point para GitHub Action
action.yml            # Definicion de la GitHub Action
```

## 6. Archivos a crear o modificar

| Ruta | Accion | Proposito | Ejemplo a seguir |
|---|---|---|---|
| `src/llm/types.ts` | NUEVO | Clase abstracta LLMAdapter y tipos del router | `src/types.ts` |
| `src/llm/factory.ts` | NUEVO | Factory que crea el adapter segun provider | -- |
| `src/llm/openai.ts` | NUEVO | Adapter OpenAI (extraido de `src/openai.ts`) | `src/openai.ts` actual |
| `src/llm/anthropic.ts` | NUEVO | Adapter Anthropic Claude | `src/llm/openai.ts` |
| `src/llm/gemini.ts` | NUEVO | Adapter Google Gemini | `src/llm/openai.ts` |
| `src/llm/ollama.ts` | NUEVO | Adapter Ollama (local) | `src/llm/openai.ts` |
| `src/llm/json-parser.ts` | NUEVO | Parser JSON con retry y validacion | -- |
| `src/rules.ts` | NUEVO | Engine de merge de reglas por categoria | `src/config.ts` (patron de merge) |
| `src/action.ts` | NUEVO | Entry point de la GitHub Action | `src/cli.ts` |
| `action.yml` | NUEVO | Definicion de la GitHub Action para GitHub | -- |
| `src/openai.ts` | ELIMINAR | Reemplazado por `src/llm/openai.ts` | -- |
| `src/types.ts` | MODIFICAR | Agregar `ProviderName`, actualizar `ReviewerConfig` | -- |
| `src/config.ts` | MODIFICAR | Soportar nuevos campos de config (provider, providerModel, ollamaUrl) | -- |
| `src/reviewer.ts` | MODIFICAR | Usar LLM factory en vez de llamar openai.ts directo | -- |
| `src/prompts.ts` | MODIFICAR | Recibir reglas mergeadas, no cargar templates | -- |
| `src/github.ts` | MODIFICAR | Aplicar formato estandarizado de comentarios | -- |
| `src/output.ts` | MODIFICAR | Mostrar provider usado en la salida terminal | -- |
| `src/cli.ts` | MODIFICAR | Agregar opcion `--provider` | -- |

### Detalle por archivo

#### `src/llm/types.ts`

- **Responsabilidad**: Definir la clase abstracta `LLMAdapter` que todos los providers extienden, el tipo `ProviderName`, y `LLMConfig`
- **Ejemplo a seguir**: `src/types.ts` (mismo estilo de tipos exportados)
- **No mezclar**: Logica de negocio, imports de SDKs especificos de providers

```typescript
export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface LLMConfig {
  provider: ProviderName;
  model: string;
  ollamaUrl?: string;  // solo para Ollama
  temperature?: number;
  // API keys NO van en config — se leen de env vars (GitHub Secrets)
  // Cada adapter lee su key en validateConfig(): process.env.OPENAI_API_KEY, etc.
}

export interface LLMResponse {
  content: string; // JSON string del ReviewResult
  tokensUsed?: { prompt: number; completion: number; total: number };
}

/**
 * Clase abstracta que define el contrato para todos los LLM adapters.
 * Cada provider extiende esta clase e implementa review().
 * El constructor recibe LLMConfig y cada subclase inicializa su SDK client.
 */
export abstract class LLMAdapter {
  abstract readonly provider: ProviderName;
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  abstract review(args: { systemPrompt: string; userPrompt: string }): Promise<LLMResponse>;

  /** Valida que la config tenga lo necesario para este provider (API key, model, etc). Lanza error descriptivo si falta algo. */
  abstract validateConfig(): void;
}
```

#### `src/llm/factory.ts`

- **Responsabilidad**: Funcion factory `createLLMAdapter(config: LLMConfig): LLMAdapter` que instancia la clase del adapter correspondiente al provider, llama a `validateConfig()`, y retorna la instancia
- **Ejemplo a seguir**: Factory pattern clasico — switch por `config.provider`, instancia `new OpenAIAdapter(config)`, etc.
- **No mezclar**: Logica de parsing, llamadas a APIs

#### `src/llm/openai.ts`

- **Responsabilidad**: Clase `OpenAIAdapter extends LLMAdapter`. `validateConfig()` verifica que `process.env.OPENAI_API_KEY` exista. El constructor inicializa el client `OpenAI` con la key leida de la env var. Usa `response_format: json_schema` con el `REVIEW_SCHEMA` constante.
- **Ejemplo a seguir**: `src/openai.ts` actual (refactor a clase)
- **No mezclar**: Logica de otros providers

#### `src/llm/anthropic.ts`

- **Responsabilidad**: Clase `AnthropicAdapter extends LLMAdapter`. Inicializa el client `Anthropic` en el constructor. Pide JSON en el system prompt. Parsea la respuesta con `json-parser.ts`. `validateConfig()` verifica que `ANTHROPIC_API_KEY` exista.
- **Ejemplo a seguir**: `src/llm/openai.ts` (misma estructura de clase)
- **No mezclar**: Logica de OpenAI

#### `src/llm/gemini.ts`

- **Responsabilidad**: Clase `GeminiAdapter extends LLMAdapter`. Inicializa `GoogleGenerativeAI` en el constructor. Pide JSON en el prompt. Parsea con `json-parser.ts`. `validateConfig()` verifica que `GEMINI_API_KEY` exista.
- **Ejemplo a seguir**: `src/llm/openai.ts` (misma estructura de clase)
- **No mezclar**: Logica de otros providers

#### `src/llm/ollama.ts`

- **Responsabilidad**: Clase `OllamaAdapter extends LLMAdapter`. Usa fetch nativo contra `config.ollamaUrl` (default `http://localhost:11434`). Pide JSON en el prompt. Parsea con `json-parser.ts`. `validateConfig()` solo verifica que `config.model` sea no-vacio y que `config.ollamaUrl` sea un string no-vacio — no hace network check. El error de conectividad se lanza en `review()` al intentar el fetch.
- **Ejemplo a seguir**: `src/llm/openai.ts` (misma estructura de clase)
- **No mezclar**: Dependencias externas — solo fetch nativo

#### `src/llm/json-parser.ts`

- **Responsabilidad**: Funcion `parseReviewJSON(raw: string): ReviewResult` que extrae JSON de una respuesta LLM, valida la estructura, y reintenta con limpieza si el JSON esta malformado. Estrategias de parseo en orden:
  1. `JSON.parse(raw)` directo
  2. Strip markdown code fences (`` ```json ... ``` `` o `` ``` ... ``` ``) y re-parsear
  3. Extraer el primer substring `{...}` con regex balanceado y re-parsear
  Si las 3 fallan, lanzar error con los primeros 200 chars de la respuesta raw.
  Despues de parsear, validar que el objeto tenga los campos requeridos de `ReviewResult` (`summary`, `findings`, `recommendation`).
- **No mezclar**: Llamadas a APIs

#### `src/rules.ts`

- **Responsabilidad**: Merge jerarquico de reglas por categoria
- **Ejemplo a seguir**: `src/config.ts` (patron de merge sobre defaults)
- **No mezclar**: Carga de config general, construccion de prompts

**Tipo `CategoryRules`:**

```typescript
/** Reglas parseadas por categoria. Cada key es un CheckCategory, el value es el texto markdown de las reglas para esa categoria. */
export type CategoryRules = Partial<Record<CheckCategory, string>>;
```

**Funciones:**

- `loadProjectRules(cwd): CategoryRules` — Lee el `code-review-rules.md` del proyecto (referenciado en `.ai-review.yml` via `rules:`). El archivo se parsea por secciones H2 cuyo titulo coincida con un `CheckCategory` (ej: `## security`, `## performance`). Contenido que no este bajo un H2 de categoria se asigna a una key especial `_general`. Si no hay archivo de reglas, retorna `{}`.
- `loadGlobalRules(tech: TechStack): CategoryRules` — Lee el template built-in de `templates/<tech>-rules.md`. Se parsea con la misma logica de secciones H2 por categoria.
- `mergeRules(project: CategoryRules, global: CategoryRules, enabledChecks: Record<CheckCategory, boolean>): string` — Para cada categoria habilitada en `enabledChecks`: si `project[cat]` existe y no esta vacio, usa esa; sino usa `global[cat]`. Concatena todo en un solo string markdown con headers de categoria, listo para inyectar en el system prompt.

**Ejemplo concreto del merge:**

```
# Input
project = { security: "No usar funciones de ejecucion dinamica...", performance: "" }
global  = { security: "OWASP top 10...", performance: "Evitar N+1 queries...", maintainability: "DRY..." }
enabledChecks = { security: true, performance: true, maintainability: true, ... }

# Output (string)
## security
No usar funciones de ejecucion dinamica...  <- proyecto gana (tiene contenido)

## performance
Evitar N+1 queries...                       <- global gana (proyecto esta vacio)

## maintainability
DRY...                                      <- global gana (proyecto no define esta categoria)
```

#### `src/action.ts`

- **Responsabilidad**: Entry point para `action.yml`. Lee inputs de GitHub Action (`INPUT_*` env vars), mapea a opciones del CLI, y llama a `reviewPullRequest()`. Escribe outputs al archivo `$GITHUB_OUTPUT` (NO usar `::set-output` que esta deprecado). NO llamar a `dotenv/config` — en Actions los secrets vienen del runner.
- **Outputs expuestos**: `review-posted` (true/false), `findings-count` (numero), `recommendation` (approve/comment/request_changes)
- **Ejemplo a seguir**: `src/cli.ts` (patron de entry point)
- **No mezclar**: Logica de review

#### `action.yml`

- **Responsabilidad**: Definicion de la GitHub Action para GitHub
- **Runs block**: `using: 'node20'`, `main: 'dist/action.js'` — `dist/` se commitea al repo (pre-built, como es convencion en GitHub Actions)
- **Inputs**: `provider` (optional, override del `.ai-review.yml`), `model` (optional, override), `language` (default: es), `tech` (optional), `config-path` (optional), `rules-path` (optional), `min-severity` (default: minor), `dry-run` (default: false). Todos los inputs son overrides opcionales — la configuracion principal vive en `.ai-review.yml` del repo del usuario.
- **Secrets via env vars**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` — el usuario los configura como GitHub Secrets en su repo u organizacion y los pasa en el bloque `env:` del workflow step
- **Outputs**: `review-posted` (boolean string), `findings-count` (number string), `recommendation` (approve/comment/request_changes)
- **No mezclar**: Logica de negocio

## 7. API Contract

Sin API surface -- no aplica. Este proyecto es un CLI/GitHub Action que consume APIs externas (OpenAI, Anthropic, Gemini, Ollama, GitHub) pero no expone endpoints propios.

## 8. Criterios de exito

- [ ] `npm run build` compila sin errores
- [ ] Correr `review-file` con `--provider openai` produce un review identico al comportamiento actual
- [ ] Correr `review-file` con `--provider anthropic` produce un review valido con estructura ReviewResult
- [ ] Correr `review-file` con `--provider gemini` produce un review valido con estructura ReviewResult
- [ ] Correr `review-file` con `--provider ollama` (con Ollama corriendo local) produce un review valido
- [ ] Si el proyecto define reglas custom para `security`, las reglas globales de security NO se aplican
- [ ] Si el proyecto NO define reglas para `performance`, las reglas globales de performance SI se aplican
- [ ] La Action se puede usar en un workflow con `uses: giolabs/ai-code-reviewer@v1` y postea review en el PR
- [ ] El CLI sigue funcionando sin cambios para usuarios existentes (backward compat con `--provider` defaulteando a `openai`)
- [ ] El formato de comentarios en el PR sigue la estructura estandarizada global

### Tests requeridos

| Test file | Scenarios |
|---|---|
| `test/llm/factory.test.ts` | Crea adapter correcto por provider, lanza error en provider invalido |
| `test/llm/json-parser.test.ts` | Parsea JSON limpio, JSON con code fences, JSON invalido con retry, JSON irrecuperable |
| `test/rules.test.ts` | Merge con proyecto completo, merge parcial por categoria, sin reglas de proyecto, sin reglas globales |
| `test/config.test.ts` | Config con provider/providerModel, config sin provider (default openai), config con ollamaUrl |

### Comandos de verificacion

```bash
npm run build
# No hay linter ni tests configurados aun — se agregan en fase posterior
```

## 9. Criterios de UX

### Loading

- El CLI imprime `Llamando a <ProviderName>...` (ej: `Llamando a Anthropic Claude...`) durante la llamada al LLM
- En modo Action, no hay output interactivo — solo logs de Actions

### Formularios

No aplica -- no hay formularios.

### Passwords

No aplica.

### Errores

- API key faltante: error especifico por provider con instrucciones de como configurarla
- Provider no reconocido: `Error: Provider '<name>' no soportado. Opciones: openai, anthropic, gemini, ollama`
- Falla de parsing JSON (despues de retries): `Error: No se pudo parsear la respuesta de <provider>. Respuesta raw: <primeros 200 chars>`
- Ollama no disponible: `Error: No se pudo conectar a Ollama en <url>. Asegurate de que Ollama este corriendo.`

### Navegacion

No aplica -- es CLI.

### Accesibilidad

No aplica -- es CLI.

## 10. Decisiones tomadas

| Decision | Why |
|---|---|
| Adapter pattern con clases (OOP) | Los adapters se implementan como clases que implementan la interfaz abstracta `LLMAdapter`. La factory instancia la clase correcta. Esto permite encapsular estado del SDK client (API key, config) en el constructor y exponer un contrato limpio via la interfaz |
| API keys exclusivamente via GitHub Secrets (env vars) | Las keys nunca se leen de archivos del repo (ni `.env` ni `.ai-review.yml`). En el contexto Action, vienen de GitHub Secrets; en CLI local, de env vars del shell. Esto evita que keys se commiteen accidentalmente |
| JSON parse con retry en vez de tool/function calling | Gemini y Ollama no tienen soporte uniforme de function calling; JSON en prompt es el minimo comun denominador |
| OpenAI mantiene `response_format: json_schema` | Es mas confiable que JSON en prompt; no degradar un provider que ya funciona bien |
| Merge de reglas por categoria, no override total | Permite que un proyecto customice solo lo que necesita sin perder las reglas globales del resto |
| GitHub Action (no GitHub App) | No requiere servidor propio, mas simple de distribuir, el usuario controla su runner y secrets |
| Formato de PR comments fijo, no configurable | Reducir complejidad en fase 1; se puede hacer configurable despues |
| Ollama config via `ollamaUrl` en `.ai-review.yml` | Consistente con el resto de la config file-based; no agregar env vars innecesarias |
| `requireApiKey` por provider en vez de un validador generico | Cada provider necesita mensajes de error distintos con instrucciones especificas |
| Entry point separado `action.ts` para la Action | Separar concerns: el CLI tiene Commander, la Action lee `INPUT_*` env vars — mezclarlos complica ambos |
| `model` en config se mantiene como alias de `providerModel` | Backward compat: configs existentes con `model: gpt-4o-mini` siguen funcionando. `providerModel` toma precedencia si ambos estan. `DEFAULT_CONFIG` pasa a tener `provider: 'openai'` y `model: 'gpt-4o-mini'` (sin `providerModel`). El resolver en config.ts lee `providerModel ?? model` |
| `action.ts` NO llama a `dotenv/config` | En GitHub Actions los secrets vienen del runner; cargar `.env` podria pisar env vars o filtrar datos |
| `dist/` se commitea al repo | Convencion estandar de GitHub Actions — la Action ejecuta directamente `dist/action.js` sin paso de build |
| Strings de UI hardcoded en espanol, sin sistema de i18n | El proyecto no tiene i18n formal. El campo `language` del config controla el idioma del review (lo que escribe el LLM), no la UI del CLI |

## 11. Edge cases

### Datos invalidos

- Config con `provider` invalido: error con lista de providers validos
- Config con `model` vacio para un provider: usar modelo default del adapter:
  - OpenAI: `gpt-4o-mini`
  - Anthropic: `claude-sonnet-4-5-20250514`
  - Gemini: `gemini-2.0-flash`
  - Ollama: no hay default — lanzar error `Modelo requerido para Ollama. Especificalo en providerModel o model.`
- `ollamaUrl` con URL malformada: error al intentar conectar, no validar formato

### API errors

- **400**: `Error del provider: request invalido. Revisar modelo y configuracion.` + raw error message
- **401**: `Error de autenticacion con <provider>. Verificar que la API key sea valida.`
- **403**: `Acceso denegado por <provider>. Verificar permisos de la API key.`
- **404**: `Modelo '<model>' no encontrado en <provider>. Verificar el nombre del modelo.`
- **429**: `Rate limit de <provider>. Esperar e intentar de nuevo, o usar otro provider.`
- **500**: `Error interno de <provider>. Reintentar o cambiar de provider.`

### Sin conexion

- Network error: `Error de conexion con <provider>. Verificar conectividad a internet.`
- Ollama offline: `No se pudo conectar a Ollama en <url>. Verificar que el servicio este corriendo.`

### Timeout

- Timeout de 120s por defecto en la llamada al LLM. Si se supera: `Timeout: <provider> no respondio en 120 segundos. Intentar con un modelo mas chico o reducir el tamano del diff.`

### Respuesta vacia o inesperada

- Respuesta vacia del LLM: `Error: <provider> devolvio una respuesta vacia.`
- JSON valido pero no matchea ReviewResult: `Error: La respuesta de <provider> no tiene la estructura esperada. Campos faltantes: <lista>`
- JSON con markdown code fences: `json-parser.ts` los stripea antes de parsear (caso comun con Gemini y Ollama)

### Doble submit

No aplica -- cada ejecucion es independiente y stateless.

## 12. Estados de UI requeridos

No aplica en el sentido tradicional de UI. Los estados relevantes del CLI son:

| State | What is shown | User can... |
|---|---|---|
| idle | Nada (CLI esperando comando) | Ejecutar cualquier comando |
| loading | `Llamando a <Provider>...` | Esperar (Ctrl+C para cancelar) |
| success | Review completo con findings | Leer output, guardar con `--save` |
| error | Mensaje de error con contexto | Corregir config y reintentar |
| empty | `No hay archivos para revisar...` | Verificar filtros de ignore |

## 13. Validaciones

### Validaciones de cliente

| Campo | Regla | Mensaje |
|---|---|---|
| `provider` | Debe ser `openai`, `anthropic`, `gemini`, u `ollama` | `Provider '<value>' no soportado. Opciones: openai, anthropic, gemini, ollama` |
| API key del provider | Debe existir como env var provista via GitHub Secrets (excepto Ollama que no requiere key) | `<PROVIDER>_API_KEY no esta definida. Agregala como secret en tu repo (Settings > Secrets > Actions).` |
| `ollamaUrl` | Debe ser una URL valida si provider es ollama | Error de conexion al intentar llamar |
| `providerModel` | Opcional; si no se da, usa default del adapter | -- |

### Validaciones de servidor

No aplica -- no hay servidor propio. Las validaciones de APIs externas se manejan en edge cases (seccion 11).

## 14. Seguridad y permisos

- **Secrets**: Todas las API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) se leen **exclusivamente** de env vars provistas por GitHub Secrets en el workflow del repositorio. NO se leen de archivos `.env`, `.ai-review.yml`, ni ningun otro archivo del repo. Las keys nunca se loguean, nunca se incluyen en el output, y nunca se persisten en disco.
- **Configuracion en el workflow**: El usuario configura las keys en **Settings → Secrets and variables → Actions** de su repo/organizacion, y las pasa en el bloque `env:` del step:
  ```yaml
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  ```
- **CLI local**: Para uso local via `npm run dev`, las keys se leen de env vars del shell (exportadas manualmente o via `.env` con dotenv solo en el entry point CLI, nunca en el Action entry point).
- **Sensitive payloads**: El codigo fuente del PR se envia al LLM elegido. El usuario es responsable de elegir un provider que cumpla con sus politicas de datos.
- **Permission checks**: La Action requiere `pull-requests: write` y `contents: read` en el workflow.
- **401/403 flow**: Error claro con instrucciones de como configurar la API key en GitHub Secrets. No retry automatico en errores de auth.
- **Ollama**: Corre local, no envia datos fuera de la red del usuario. No requiere API key. Esto se menciona en la documentacion como ventaja para repos con codigo sensible.

## 15. Observabilidad y logging

- **Log**: Provider usado, modelo, cantidad de archivos, tokens consumidos (al final de cada review). En modo Action, usar `core.info()` de `@actions/core`.
- **Never log**: API keys, contenido completo de archivos, raw prompts (son muy largos). Solo loguear metadata.
- **Mechanism**: `console.log` con chalk para CLI (existente en `src/output.ts`). Para el Action entry point, `@actions/core` para logging estructurado de Actions.
- **DEBUG mode**: Cuando `DEBUG=true`, imprimir el system prompt y user prompt completos (ya existente, extender a todos los providers).

## 16. i18n / textos visibles

| Key | Texto |
|---|---|
| `provider_loading` | `Llamando a {provider}...` |
| `provider_not_supported` | `Provider '{name}' no soportado. Opciones: openai, anthropic, gemini, ollama` |
| `api_key_missing_openai` | `OPENAI_API_KEY no esta definida. Agregala como secret en tu repo (Settings > Secrets > Actions) y pasala en el bloque env del workflow.` |
| `api_key_missing_anthropic` | `ANTHROPIC_API_KEY no esta definida. Obtene una en console.anthropic.com y agregala como secret en tu repo (Settings > Secrets > Actions).` |
| `api_key_missing_gemini` | `GEMINI_API_KEY no esta definida. Obtene una en aistudio.google.com y agregala como secret en tu repo (Settings > Secrets > Actions).` |
| `ollama_connection_error` | `No se pudo conectar a Ollama en {url}. Asegurate de que este corriendo.` |
| `json_parse_error` | `No se pudo parsear la respuesta de {provider}.` |
| `review_header` | `## 🤖 AI Code Review` |
| `rules_merge_info` | `Reglas: {projectCount} del proyecto + {globalCount} globales` — emitido por `src/output.ts` en la salida terminal junto al header del review (seccion loading, despues de `Llamando a {provider}...`) |

*Nota: este proyecto no usa un sistema de i18n formal. Los strings estan hardcoded en espanol. El campo `language` del config cambia el idioma del review (lo que escribe el LLM), no de la UI del CLI.*

## 17. Performance

- **API calls**: Una sola llamada al LLM por review (no cambiar). Timeout de 120s.
- **Retry**: Solo para parsing de JSON (hasta 2 re-parseos del mismo string). NO re-llamar al LLM si la respuesta es invalida — es caro.
- **Main thread**: Todo corre en main thread (Node single-threaded). Las llamadas async son I/O-bound al LLM.
- **Caching**: Sin caching. Cada review es independiente y stateless.
- **Bundle size**: Agregar 3 nuevas dependencias (`@anthropic-ai/sdk`, `@google/generative-ai`, `@actions/core`). Ollama no requiere SDK.

## 18. Restricciones

El implementador NO debe:

- [ ] Agregar un servidor HTTP o base de datos
- [ ] Hacer que la Action requiera permisos mas alla de `pull-requests: write` y `contents: read`
- [ ] Re-llamar al LLM cuando el JSON parsing falla (solo re-parsear el string ya obtenido)
- [ ] Cambiar el comportamiento default: sin `--provider`, debe ser OpenAI con `gpt-4o-mini`
- [ ] Loguear API keys o contenido completo de archivos
- [ ] Leer API keys de archivos del repo (`.env`, `.ai-review.yml`, etc.) — solo de env vars
- [ ] Llamar a `dotenv/config` desde `src/action.ts` (en Actions los secrets vienen del runner)
- [ ] Agregar dependencias mas alla de las 3 listadas (`@anthropic-ai/sdk`, `@google/generative-ai`, `@actions/core`)
- [ ] Cambiar el formato de `.ai-review.yml` de forma que rompa configs existentes
- [ ] Hacer configurable el formato de PR comments (es fijo global en esta fase)
- [ ] Agregar streaming de respuestas del LLM

## 19. Entregables

- [ ] Modulo `src/llm/` con interfaz, factory, y 4 adapters
- [ ] Modulo `src/rules.ts` con merge jerarquico por categoria
- [ ] Entry point `src/action.ts` para la GitHub Action
- [ ] Archivo `action.yml` en la raiz del repo
- [ ] Modificaciones a `src/types.ts`, `src/config.ts`, `src/reviewer.ts`, `src/prompts.ts`, `src/github.ts`, `src/output.ts`, `src/cli.ts`
- [ ] Eliminacion de `src/openai.ts` (reemplazado por `src/llm/openai.ts`)
- [ ] Actualizacion de `README.md` con documentacion de multi-provider y uso como Action
- [ ] Actualizacion de `package.json` con nuevas dependencias

## 20. Checklist final para el agente

Antes de entregar, verificar:

- [ ] Leer este spec de punta a punta
- [ ] Confirmar que todas las dependencias previas (seccion 4) existen
- [ ] Modificar solo los archivos listados en seccion 6
- [ ] Seguir los ejemplos reales del proyecto citados en seccion 6
- [ ] Todos los edge cases (seccion 11) manejados
- [ ] No se agregaron dependencias no autorizadas
- [ ] No se cambiaron decisiones bloqueadas (seccion 10)
- [ ] Correr: `npm run build` sin errores
- [ ] No quedan logs temporales ni codigo de debugging
- [ ] No quedan TODOs injustificados
- [ ] Backward compatibility: `npx ai-code-reviewer review-file <file>` sigue funcionando sin `--provider`
- [ ] La Action funciona con `uses: giolabs/ai-code-reviewer@v1` en un workflow de prueba
