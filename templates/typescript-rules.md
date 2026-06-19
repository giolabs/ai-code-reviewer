# Reglas de code review para TypeScript

Aplican las reglas genéricas + las siguientes específicas de TS.

## Tipos
- Uso de `any` sin justificación en comentario → minor.
- Uso de `as` (type assertion) cuando podría usarse type guard → minor.
- `as any` o `as unknown as X` → major (bypass del type system).
- Tipos `Function`/`Object`/`{}` en vez de tipos específicos → minor.
- Falta de `readonly` en arrays/props que no se mutan → nitpick.
- Returns implícitos `any` por inferencia rota → minor.

## Null safety
- Acceso a propiedades con `!` (non-null assertion) sin garantía obvia → bug-risk.
- Optional chaining (`?.`) usado a la vez que se asume non-null líneas abajo → bug-risk.
- Falta de manejo de `undefined`/`null` en valores que el tipo lo permite → minor o major según path.

## Enums y unions
- Enums numéricos cuando un string union literal sería más seguro → nitpick.
- Switches sobre unions sin caso `default` que haga `never` check → minor.
- Discriminated unions sin discriminator string explícito → minor.

## Async
- Promesas no awaitadas (`floating promises`) → bug-risk.
- Funciones async que no necesitan ser async → nitpick.
- `try/catch` que captura el error pero pierde el stack al re-throw → minor.

## Módulos
- Imports circulares → major.
- Imports con paths relativos profundos (`../../../`) cuando hay path aliases → nitpick.
- Re-exports innecesarios en barrel files que dificultan tree-shaking → minor.

## Configuración del compilador
- Código que solo compila con `strict: false` → major (debería compilar en strict).
- Uso de `// @ts-ignore`/`// @ts-expect-error` sin comentario explicando por qué → minor.
