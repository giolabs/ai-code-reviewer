# Reglas de code review para Next.js

Aplican las reglas de React + las siguientes específicas de Next.

## App Router (Next 13+)
- Componentes con `'use client'` que podrían ser server components → minor.
- Hooks (`useState`, `useEffect`) en archivos sin `'use client'` → critical (no compila).
- Server components que importan código que solo corre en cliente → bug-risk.
- Acceso a `window`/`document`/APIs del browser sin guard de cliente en código compartido → critical.

## Data fetching
- `fetch` con caché incorrecta (default es cache: 'force-cache' en server components) → major si es data que cambia.
- `useEffect` para fetch inicial en server components disponibles → major (usar fetch directo).
- Falta de `revalidate` o `cache` apropiado según naturaleza de los datos → minor.
- Llamadas a API con datos sensibles desde el cliente cuando deberían ser server-side → major.

## Routing
- Links con `<a href>` en vez de `<Link>` para navegación interna → minor.
- `router.push()` con paths hardcodeados que deberían ser constantes → nitpick.
- Falta de `loading.tsx` o `error.tsx` en rutas que hacen data fetching → minor.

## Performance
- Imágenes sin `next/image` cuando podrían beneficiarse → minor.
- Fonts sin `next/font` (causa CLS) → minor.
- `next/dynamic` faltante para componentes grandes que solo se usan condicionalmente → minor.

## Variables de entorno
- Variables sensibles expuestas con prefijo `NEXT_PUBLIC_` → critical.
- Acceso a `process.env` sin chequear que la variable existe → minor.
- Variables de servidor accedidas desde el cliente → critical.

## API Routes / Route Handlers
- Endpoints sin validación de método HTTP → major.
- Falta de error handling que devuelve detalles internos en la respuesta → major.
- Endpoints sin auth cuando manejan data privada → critical.
