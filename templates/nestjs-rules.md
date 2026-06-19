# Reglas de code review para NestJS

Aplican además de las reglas genéricas.

## Arquitectura y módulos
- Servicios accediendo a otro módulo sin importarlo en `imports` → bug-risk.
- Lógica de negocio en controllers → major (debe estar en services/use-cases).
- Servicios con dependencias circulares → major. Resolverlas con `forwardRef` se permite solo con justificación clara.
- Uso de `@Inject()` con strings mágicos sin constante → minor.

## DTOs y validación
- Endpoints que reciben body sin DTO con `class-validator` decorators → major.
- DTOs sin `@IsOptional()` donde corresponde, o validaciones laxas (`@IsString()` solo cuando el campo claramente requiere más) → minor.
- Reutilización de entities como DTOs de entrada → major (expone campos internos).
- Falta de `ValidationPipe` global o por endpoint → major si es endpoint público.

## Persistencia
- Queries crudas con interpolación de strings (concat de SQL) → critical.
- Uso de `findOne({ where })` que puede devolver null sin manejar → minor o major según el path.
- Repositorios accedidos directamente desde controllers → major (debe ir vía service).
- Transacciones omitidas en operaciones que mutan múltiples entities → major.
- N+1 al hacer `findAll()` y luego acceder a relaciones lazy en loop → major.

## Async / observables
- Uso de `Promise.all` con array de promesas que pueden fallar parcialmente sin error handling → minor.
- Subscriptions a Observables sin unsubscribe (cuando aplique a guards/interceptors) → bug-risk.
- `async` sin `await` (función marcada como async pero retorna sincrónica) → minor.

## Seguridad NestJS
- Endpoints sin `@UseGuards()` cuando el módulo expone data sensible → major.
- Roles/permisos hardcodeados en strings sin enum → minor.
- CORS con `origin: '*'` en producción → major.
- Falta de rate limiting en endpoints públicos sensibles (login, signup, password reset) → major.

## Testing
- Services nuevos sin tests unitarios → minor.
- E2E nuevos para endpoints sin happy path + al menos un error case → minor.
- Mocks de repositorios que no respetan la interfaz real → bug-risk.

## Logs y observabilidad
- `console.log` en código de producción → minor (usar `Logger` de Nest).
- Logs de información sensible (passwords, tokens, body completo de requests con PII) → major.
- Errores tragados sin loguear ni rethrow → major.
