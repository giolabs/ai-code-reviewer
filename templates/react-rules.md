# Reglas de code review para React

Aplican además de las reglas genéricas.

## Hooks
- Reglas de hooks rotas (hooks dentro de condicionales/loops/callbacks) → critical.
- `useEffect` con array de deps incorrecto (falta deps, deps de más, array vacío cuando no corresponde) → major.
- `useEffect` con cleanup faltante para subscriptions, timers, listeners → bug-risk.
- Estado derivado guardado en `useState` cuando debería calcularse en render → minor.
- `useMemo`/`useCallback` aplicados sin razón (no son optimizaciones gratis) → nitpick.

## Renders y performance
- Funciones inline pasadas como props que causan re-renders innecesarios en árboles grandes → minor.
- Lists renderizadas sin `key` estable (usando index cuando el orden puede cambiar) → bug-risk.
- Componentes que mutan props o estado fuera de un setter → critical.
- Re-fetches en cada render por dependencias inestables → major.

## Estado
- Estado global agregado para algo que debería ser local → minor.
- `useState` con objetos grandes que se reemplazan completos en cada update → minor.
- Estado duplicado entre múltiples componentes en vez de lift up → minor.

## Forms y eventos
- Forms sin validación o con validación inconsistente entre cliente y server → major.
- `preventDefault()` faltante donde se espera prevenir comportamiento default del browser → bug-risk.
- Inputs no controlados mezclados con controlados arbitrariamente → minor.

## Accesibilidad
- Botones con `<div onClick>` en vez de `<button>` → minor.
- Imágenes sin `alt` → minor.
- Inputs sin `<label>` asociado → minor.
- Foco no manejado en modales/dialogs → minor.

## TypeScript / PropTypes
- Props con tipo `any` o `unknown` sin justificación → minor.
- Componentes que reciben children sin tipar correctamente → nitpick.

## Seguridad
- `dangerouslySetInnerHTML` con contenido no sanitizado → critical.
- `href` directo desde user input sin validar (XSS via javascript: URLs) → major.
- API keys o secretos en el bundle del cliente → critical.
