# Reglas generales de code review

## Seguridad
- Inputs del usuario sin validar/sanitizar → minor o major según contexto.
- Secretos hardcodeados (API keys, passwords, tokens) → critical.
- SQL/command injection, path traversal, XSS, SSRF → critical.
- Dependencias desactualizadas con CVE conocidos → major.
- Logging de información sensible (passwords, tokens, PII) → major.

## Bug risk
- Race conditions en código async.
- Null/undefined sin manejar donde el tipo lo permite.
- Off-by-one en loops e índices.
- Recursos no liberados (file handles, conexiones, subscriptions).
- Errores silenciados con `catch {}` vacíos sin justificación.

## Performance
- Loops anidados sobre colecciones grandes sin necesidad.
- Queries N+1 en código que toca DB.
- Operaciones síncronas bloqueantes en paths críticos.
- Re-cálculos innecesarios que podrían memoizarse.

## Mantenibilidad
- Funciones con más de ~50 líneas o demasiados parámetros (5+).
- Magic numbers/strings sin constante con nombre.
- Duplicación obvia (DRY) — pero solo si la abstracción es clara.
- Naming confuso o inconsistente con el resto del archivo.
- Comentarios mentirosos (desactualizados respecto al código).

## Testing
- Lógica nueva sin tests cuando hay infra de tests en el repo.
- Tests que dependen de orden de ejecución.
- Tests que mockean lo que están probando.
- Assertions vagas (toBeTruthy en vez de toBe(value específico)).

## Architecture
- Violaciones de boundaries entre capas (cuando el proyecto las tiene definidas).
- Lógica de negocio en controllers/UI.
- Estado global mutable agregado innecesariamente.

## Lo que NO es un finding
- Estilo de código que el formatter del proyecto ya maneja.
- Preferencias personales sin razón técnica.
- "Esto podría hacerse de otra forma" sin un problema concreto.
