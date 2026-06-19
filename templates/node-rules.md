# Reglas de code review para Node.js

Aplican las reglas genéricas + las siguientes específicas de Node.

## Async / event loop
- Operaciones sync (`fs.readFileSync`, `crypto` heavy) en handlers de servidor → major.
- `Promise` sin error handler (`.catch` o try/await) → bug-risk.
- Unhandled rejections → major.
- Loops sobre arrays con `await` dentro que podrían paralelizarse con `Promise.all` → minor.

## Streams y backpressure
- Streams sin manejo de `error` event → bug-risk.
- Pipes sin `pipeline()` cuando hay múltiples streams → minor.
- Lectura completa a memoria de archivos grandes en vez de stream → major si el tamaño puede ser grande.

## HTTP
- Falta de timeouts en clientes HTTP → major.
- Sin límite de payload en endpoints (body parser sin `limit`) → major.
- Headers sensibles loguados → major.
- Respuestas que filtran detalles internos (stack traces) a clientes en prod → major.

## File system / paths
- `path.join` con segmentos provenientes del usuario sin validar → critical (path traversal).
- Apertura de archivos sin cerrar (sin `try/finally` o sin `using`) → bug-risk.
- Permisos de archivos creados muy permisivos (`0777`) → major.

## Dependencias
- `require`/`import` dinámicos con strings de usuario → critical.
- Uso de paquetes deprecated → minor.
- Múltiples librerías que hacen lo mismo (e.g. axios + fetch + node-fetch) → nitpick.

## Process / OS
- `process.exit()` en código de librería → major.
- `process.env` accedido directamente sin un módulo de config centralizado → minor.
- Operaciones que asumen un OS (paths con `/`, separadores) → minor.
