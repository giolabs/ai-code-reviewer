# Reglas de code review para Flutter / Dart

Aplican las reglas genéricas + las siguientes específicas de Flutter.

## Widgets y rebuild
- `setState` llamado fuera del widget al que pertenece → critical.
- `StatelessWidget` con campos mutables → bug-risk.
- Trees profundos sin extraer en widgets reutilizables → minor.
- `BuildContext` capturado y usado después de `await` sin `mounted` check → bug-risk.
- `MediaQuery.of(context)` o `Theme.of(context)` llamados en loops dentro de build → minor.

## Estado
- Provider/Bloc/Riverpod misused (e.g. recrear providers en cada build) → major.
- StreamControllers/AnimationControllers sin `dispose` → bug-risk.
- Estado de UI guardado en variables globales sin razón → minor.

## Performance
- `Opacity` sobre subtrees grandes (usar `AnimatedOpacity` o `FadeTransition`) → minor.
- Imágenes grandes sin `cacheWidth`/`cacheHeight` → minor.
- ListView sin `itemBuilder` para listas largas → major.
- `const` faltante en widgets que podrían serlo → nitpick.

## Async
- `Future` sin awaitar ni retornar (fire-and-forget no intencional) → bug-risk.
- Llamadas async en `initState` sin manejo de errores ni de unmount → bug-risk.

## Null safety
- Uso de `!` (non-null assertion) sin guarantía → bug-risk.
- Operaciones sobre nullable sin `??` o `?.` → minor.

## Plataforma
- Uso de APIs específicas de una plataforma sin guard (`Platform.isIOS`) → bug-risk.
- Assets referenciados sin estar declarados en `pubspec.yaml` → critical.
