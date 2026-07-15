# Buscador: tabla paginada en lugar de tarjetas — Diseño

**Fecha:** 2026-07-15
**App:** `apps/laboratorios-ambientales`
**Origen:** petición del usuario tras ver el Buscador funcionando en el banco de pruebas («me gustaría que se viera en forma de tabla»).

## Problema

El Buscador presenta los resultados como una rejilla de tarjetas (3 por fila, tope de 60). Cada tarjeta es una ficha: buena para leer un registro, mala para escanear y comparar muchos. Con 19.056 registros y una media de ~12 acreditaciones por laboratorio, el uso real es comparar filas, no leer fichas.

Dos defectos concretos de la vista actual:

1. **Densidad.** 60 tarjetas ocupan 20 filas de pantalla y muestran 60 de 19.056 registros.
2. **Ubicación duplicada.** [Buscador.tsx:271](../../../apps/laboratorios-ambientales/src/pages/Buscador.tsx#L271) hace `[ciudad, departamento].filter(Boolean).join(', ')`. En **8.631 registros — el 45% del dataset** — ciudad y departamento son el mismo valor y sale `Bogotá, D.C., Bogotá, D.C.` (verificado contra la API; el 100% de los casos son Bogotá). No es un detalle cosmético menor: afecta a casi la mitad de los resultados.

## Alcance

**Cambia:** el bloque de resultados de `src/pages/Buscador.tsx` (líneas ~240-296, la rejilla de tarjetas).

**No cambia:** los filtros ni la cascada, el estado vacío, `src/pages/Dashboard.tsx` (ya es una tabla), ni nada de `src/lib/` o `src/services/`.

## Diseño

### La tabla

Seis columnas, los mismos campos que la tarjeta:

| Columna | Campo | Notas |
|---|---|---|
| Laboratorio | `nombreLaboratorio` | |
| Variable | `variable` | El parámetro acreditado |
| Matriz | `matriz` | |
| Ubicación | `ciudad` + `departamento` | Si son iguales, se muestra **una sola vez** |
| Estado | `estado` | Badge `bg-emerald-500` si `'Activa'`, `bg-slate-400` si no |
| Método | `metodo` | Truncado a una línea; texto completo en el atributo `title` |

- Encabezado `sticky` al hacer scroll vertical.
- `hover` en las filas.
- Contenedor con `overflow-x-auto`: en móvil se desplaza en vez de romper el ancho de la página.
- El método es texto largo (`U.S EPA CFR Título 40, Capítulo I, Subcapítulo C, Parte 50, Apéndice A-1. Método Equivalente Automatizado: EQSA-0495-100`). Se trunca con `truncate` sobre un ancho máximo; el `title` da acceso al valor completo sin más UI.

**Estilo:** el mismo lenguaje que `Dashboard.tsx`, que ya tiene una tabla: `bg-slate-50` en el `thead`, `border-t border-slate-100` entre filas, `text-sm`.

### Paginación

- **50 filas por página.**
- Controles `Anterior` / `Siguiente`, deshabilitados en los extremos.
- Indicador: «Página 3 de 382 · 19.056 registros».
- **Al cambiar cualquier filtro, vuelve a la página 1.** Sin esto, estando en la página 300 y filtrando a 5 resultados se vería una tabla vacía.
- La página vive como estado local de `Buscador`, no en `App`: al ir al menú y volver, se empieza en la 1. Los filtros sí se conservan (siguen viviendo en `App`), como ahora.

### Unidades

**`src/lib/pagination.ts` (nuevo).** Lógica pura, testeable sin DOM, siguiendo el patrón de `filters.ts`:

- `PAGE_SIZE = 50`
- `totalPages(totalItems)` — mínimo 1, incluso con 0 registros (no existe «página 0 de 0»).
- `pageSlice(items, page)` — la porción visible. Acota `page` al rango válido: fuera de rango devuelve la última página en vez de un array vacío. Es una **red de seguridad**, no el mecanismo principal — quien devuelve a la página 1 al filtrar es el `useEffect` de `Buscador`. Existe para que la función sea total: nunca deja la tabla en blanco por un índice inválido.
- `pageRange(totalItems, page)` — para el indicador.

**`src/pages/Buscador.tsx` (modificado).** Sustituye la rejilla por la tabla, añade `useState` para la página, y un `useEffect` que la resetea a 1 cuando cambian los filtros.

### Casos límite

| Caso | Comportamiento |
|---|---|
| 0 registros | Estado vacío actual, sin controles de paginación |
| Exactamente 50 | 1 página, ambos botones deshabilitados |
| 51 registros | 2 páginas, la segunda con 1 fila |
| Página fuera de rango tras filtrar | Se corrige a la última válida; el `useEffect` la lleva a 1 |
| `ciudad === departamento` | Se muestra una sola vez |
| `metodo` vacío | «No especificado», como ahora |

## Fuera de alcance (decidido)

- **Ordenar por columna.** No se ha pedido; añade estado y complejidad. Si al usar la tabla se echa en falta, se añade después.
- **Salto a página concreta.** Con 382 páginas, pasarlas a mano no es una forma realista de encontrar nada: para eso están los filtros. `Anterior`/`Siguiente` basta para hojear.
- **Virtualización.** Requeriría una dependencia nueva para un problema que la paginación ya resuelve.

## Verificación

- **Tests unitarios** de `pagination.ts` (vitest, como el resto de `src/lib/`): los seis casos límite de la tabla de arriba.
- **Navegador**, en el banco de pruebas: que las 50 filas se pinten, que `Siguiente` avance, que filtrar devuelva a la página 1, que el badge siga verde con `Activa`, y que `Bogotá, D.C.` aparezca una sola vez.
- `npm run build --workspace=apps/portal` en exit 0: es el build que se despliega.
