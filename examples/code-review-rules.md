# Reglas custom del proyecto

Estas reglas se concatenan al system prompt cuando se referencia este archivo
desde `.ai-review.yml`. Tienen prioridad sobre las reglas built-in.

## Convenciones del equipo
- Todos los servicios deben tener un test unitario que cubra al menos el
  happy path → minor si falta.
- Endpoints públicos requieren documentación OpenAPI con `@ApiOperation` y
  `@ApiResponse` → minor si falta.
- Variables de entorno deben accederse vía el módulo `ConfigService`, nunca
  `process.env` directo → minor.

## Patrones obligatorios
- Cualquier handler de error debe loguear con `Logger` de Nest, no con
  `console.error` → minor.
- DTOs de input deben heredar de una base que define `createdAt`/`updatedAt`
  como excluidos → minor.

## Patrones prohibidos
- Uso de `any` en código de dominio → major.
- Acceso directo al repositorio desde el controller → major.
- Hardcoded de URLs, montos, o constantes de negocio → minor.

## Excepciones aceptadas
- Tests pueden usar `as any` libremente — es un trade-off conocido.
- Scripts de migración una sola vez no requieren tests.
