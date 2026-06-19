# Reglas de code review para Laravel / PHP

Aplican las reglas genéricas + las siguientes específicas de Laravel.

## Eloquent y queries
- N+1 queries (loops accediendo a relaciones sin `with()`) → major.
- Mass assignment sin `$fillable`/`$guarded` definido o con `$guarded = []` → major.
- Queries con interpolación de strings (`whereRaw` con input del usuario) → critical.
- `Model::all()` sobre tablas grandes → major.
- Falta de eager loading en respuestas paginadas → minor.

## Requests y validación
- Controllers que validan inline en vez de usar FormRequest → minor.
- FormRequests con `authorize` que retorna `true` siempre → minor.
- Endpoints que aceptan input sin validar → major.
- Mass assignment desde request directo (`Model::create($request->all())`) sin validación → major.

## Seguridad
- Vistas Blade con `{!! $var !!}` sobre user input → critical (XSS).
- Rutas sin middleware `auth` cuando deberían tenerlo → major.
- CSRF deshabilitado en rutas que mutan estado → major.
- Storage de archivos uploadeados sin validar tipo y tamaño → major.
- `env()` fuera de archivos de config → minor (no funciona después de cache:config).

## Servicios y arquitectura
- Lógica de negocio en controllers → minor (extraer a services/actions).
- Múltiples queries en un mismo método sin transacción → bug-risk si son interdependientes.
- Uso de Facades en código que debería ser inyectable → nitpick.

## Jobs y queues
- Jobs sin `tries`/`backoff` cuando hacen llamadas a APIs externas → minor.
- Jobs que mutan modelos sin lock cuando hay race conditions posibles → bug-risk.
- Falta de `ShouldBeUnique` cuando corresponde → minor.
