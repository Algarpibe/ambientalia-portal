# Tabla paginada en el Buscador — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir la rejilla de tarjetas del Buscador por una tabla paginada de 50 filas, que da acceso a los 19.056 registros en vez de a 60.

**Architecture:** La lógica de paginación sale a `src/lib/pagination.ts` como funciones puras con tests unitarios, siguiendo el patrón ya establecido por `src/lib/filters.ts`. `src/pages/Buscador.tsx` solo la orquesta: mantiene la página como estado local y la resetea a 1 cuando cambian los filtros. Nada más de la app se toca.

**Tech Stack:** React 19 + TypeScript 5.9 (strict) + Tailwind 3 (compilado por el portal) + vitest 2.

**Spec:** [2026-07-15-buscador-tabla-paginada-design.md](../specs/2026-07-15-buscador-tabla-paginada-design.md)

---

## Contexto verificado (no re-investigar)

- **19.056 registros**, que a 50 por página son **382 páginas**.
- **8.631 registros (45%)** tienen `ciudad === departamento`, y el 100% de esos casos son `Bogotá, D.C.`. Por eso hoy se lee `Bogotá, D.C., Bogotá, D.C.` en casi la mitad de los resultados.
- El campo `metodo` es texto largo: `U.S EPA CFR Título 40, Capítulo I, Subcapítulo C, Parte 50, Apéndice A-1. Método Equivalente Automatizado: EQSA-0495-100`.
- `estado` solo toma `'Activa'` (18.689) o `'Suspendida'` (367). **El badge verde va con `'Activa'`** — la versión vieja comparaba con `'VIGENTE'`, que no existe, y por eso ningún badge era verde nunca. No reintroducir ese bug.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/pagination.ts` (crear) | Lógica pura de paginación: tamaño de página, total de páginas, porción visible, rango para el indicador. Sin DOM ni React. |
| `src/lib/pagination.test.ts` (crear) | Tests de los casos límite. |
| `src/pages/Buscador.tsx` (modificar, líneas ~240-296) | Sustituir la rejilla de tarjetas por la tabla; estado de página; reseteo al filtrar. |

`src/pages/Dashboard.tsx` **no se toca**: ya es una tabla y sirve de referencia de estilo.

---

## Task 1: Lógica de paginación

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/pagination.ts`
- Test: `apps/laboratorios-ambientales/src/lib/pagination.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/laboratorios-ambientales/src/lib/pagination.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PAGE_SIZE, totalPages, pageSlice, pageRange } from './pagination';

const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('PAGE_SIZE', () => {
  it('es 50', () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

describe('totalPages', () => {
  it('devuelve 1 con cero registros: no existe «página 0 de 0»', () => {
    expect(totalPages(0)).toBe(1);
  });

  it('devuelve 1 cuando cabe justo en una página', () => {
    expect(totalPages(1)).toBe(1);
    expect(totalPages(50)).toBe(1);
  });

  it('abre una página nueva al pasarse por uno', () => {
    expect(totalPages(51)).toBe(2);
  });

  it('calcula bien el dataset completo', () => {
    expect(totalPages(19056)).toBe(382);
  });
});

describe('pageSlice', () => {
  it('devuelve las primeras 50 en la página 1', () => {
    const res = pageSlice(items(120), 1);
    expect(res).toHaveLength(50);
    expect(res[0]).toBe(1);
    expect(res[49]).toBe(50);
  });

  it('devuelve el bloque siguiente en la página 2', () => {
    const res = pageSlice(items(120), 2);
    expect(res[0]).toBe(51);
    expect(res[49]).toBe(100);
  });

  it('la última página puede venir incompleta', () => {
    expect(pageSlice(items(120), 3)).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120]);
  });

  it('devuelve vacío si no hay registros', () => {
    expect(pageSlice([], 1)).toEqual([]);
  });

  // Red de seguridad: quien devuelve a la página 1 al filtrar es el useEffect de
  // Buscador. Esto solo evita que un índice inválido deje la tabla en blanco.
  it('acota una página por encima del rango a la última válida', () => {
    expect(pageSlice(items(120), 99)).toEqual(pageSlice(items(120), 3));
  });

  it('acota una página por debajo del rango a la primera', () => {
    expect(pageSlice(items(120), 0)).toEqual(pageSlice(items(120), 1));
    expect(pageSlice(items(120), -5)).toEqual(pageSlice(items(120), 1));
  });
});

describe('pageRange', () => {
  it('describe el bloque visible de la página 1', () => {
    expect(pageRange(120, 1)).toEqual({ desde: 1, hasta: 50 });
  });

  it('recorta el final en la última página incompleta', () => {
    expect(pageRange(120, 3)).toEqual({ desde: 101, hasta: 120 });
  });

  it('devuelve un rango vacío sin registros', () => {
    expect(pageRange(0, 1)).toEqual({ desde: 0, hasta: 0 });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test --workspace=apps/laboratorios-ambientales`
Expected: FAIL — `Failed to resolve import "./pagination"`.

- [ ] **Step 3: Escribir la implementación**

Crear `apps/laboratorios-ambientales/src/lib/pagination.ts`:

```ts
// Paginación del Buscador. Son 19 056 registros (382 páginas): pintarlos todos
// no es viable y un tope mudo escondería datos, así que se pagina.
export const PAGE_SIZE = 50;

export function totalPages(totalItems: number): number {
  // Mínimo 1: sin registros la UI sigue diciendo «Página 1 de 1», no «0 de 0».
  return Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
}

// Acota la página al rango válido para que la función sea total: un índice
// inválido nunca deja la tabla en blanco.
function clampPage(page: number, totalItems: number): number {
  return Math.min(Math.max(1, Math.trunc(page)), totalPages(totalItems));
}

export function pageSlice<T>(items: T[], page: number): T[] {
  const inicio = (clampPage(page, items.length) - 1) * PAGE_SIZE;
  return items.slice(inicio, inicio + PAGE_SIZE);
}

export function pageRange(totalItems: number, page: number): { desde: number; hasta: number } {
  if (totalItems === 0) return { desde: 0, hasta: 0 };
  const inicio = (clampPage(page, totalItems) - 1) * PAGE_SIZE;
  return { desde: inicio + 1, hasta: Math.min(inicio + PAGE_SIZE, totalItems) };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm test --workspace=apps/laboratorios-ambientales`
Expected: PASS — 14 tests nuevos; el total sube de 65 a 79.

Run: `npm run build --workspace=apps/laboratorios-ambientales`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/pagination.ts apps/laboratorios-ambientales/src/lib/pagination.test.ts
git commit -m "feat(laboratorios): lógica de paginación del buscador"
```

---

## Task 2: La tabla y sus controles

**Files:**
- Modify: `apps/laboratorios-ambientales/src/pages/Buscador.tsx`

- [ ] **Step 1: Actualizar los imports y las constantes**

En la cabecera de `src/pages/Buscador.tsx`, cambiar la primera línea:

```ts
import { useEffect, useMemo, useState } from 'react';
```

Añadir tras el import de `filters`:

```ts
import { pageRange, pageSlice, totalPages } from '../lib/pagination';
```

⚠️ **No importes `PAGE_SIZE`**: este componente no lo usa (el tamaño de página vive dentro de `pagination.ts`), y `tsconfig.app.json` tiene `noUnusedLocals: true`, así que un import sin usar rompe el build.

Y **borrar** la constante `MAX_VISIBLE` con su comentario (líneas 14-16), que la paginación deja obsoleta:

```ts
// Tope de tarjetas pintadas. El encabezado sigue informando del total real: un
// recorte de render no debe disfrazarse de recuento de resultados.
const MAX_VISIBLE = 60;
```

- [ ] **Step 2: Añadir el estado de página y sustituir `visibles`**

⚠️ **`visibles` YA EXISTE** en la línea 58: `const visibles = resultados.slice(0, MAX_VISIBLE);`. Hay que **reemplazar esa línea**, no añadir otra declaración — si no, error de compilación por identificador duplicado.

Sustituir la línea 58 por este bloque:

```ts
  const [pagina, setPagina] = useState(1);

  // Al cambiar los filtros hay que volver al principio: estando en la página 300
  // y filtrando a 5 resultados, la tabla saldría vacía.
  useEffect(() => {
    setPagina(1);
  }, [filters]);

  const paginas = totalPages(resultados.length);
  const visibles = useMemo(() => pageSlice(resultados, pagina), [resultados, pagina]);
  const rango = pageRange(resultados.length, pagina);
```

Tras este paso, `MAX_VISIBLE` ya no debe aparecer en ninguna parte del fichero salvo en el encabezado de resultados, que arregla el Step 3. Compruébalo al terminar el Step 3 con:

```bash
grep -n "MAX_VISIBLE" apps/laboratorios-ambientales/src/pages/Buscador.tsx
```
Esperado: sin resultados.

- [ ] **Step 3: Sustituir el encabezado de resultados**

Reemplazar el bloque del encabezado (el `<div>` que contiene el `<h3>` «Vista por Parámetro» y el aviso de `MAX_VISIBLE`) por:

```tsx
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
          <h3 className="text-xl font-bold text-gray-800">
            Vista por Parámetro ({resultados.length.toLocaleString('es-CO')} registros)
          </h3>
          {resultados.length > 0 && (
            <p className="text-sm text-gray-500">
              Mostrando {rango.desde.toLocaleString('es-CO')}–{rango.hasta.toLocaleString('es-CO')}
            </p>
          )}
        </div>
```

- [ ] **Step 4: Sustituir la rejilla de tarjetas por la tabla**

Reemplazar el bloque completo `{resultados.length === 0 ? (...) : (<div className="grid ...">...</div>)}` por:

```tsx
        {resultados.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl text-slate-300">🔍</span>
            </div>
            <p className="text-lg font-bold text-slate-400">No se encontraron parámetros con los filtros seleccionados</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-left border-collapse">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-slate-600">Laboratorio</th>
                      <th className="px-3 py-2 font-semibold text-slate-600">Variable</th>
                      <th className="px-3 py-2 font-semibold text-slate-600">Matriz</th>
                      <th className="px-3 py-2 font-semibold text-slate-600">Ubicación</th>
                      <th className="px-3 py-2 font-semibold text-slate-600">Estado</th>
                      <th className="px-3 py-2 font-semibold text-slate-600">Método</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((registro, idx) => (
                      <tr
                        key={`${registro.codigo}-${registro.variable}-${idx}`}
                        className="border-t border-slate-100 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-3 py-2 font-medium text-slate-800">{registro.nombreLaboratorio}</td>
                        <td className="px-3 py-2 text-slate-700">{registro.variable || 'No especificado'}</td>
                        <td className="px-3 py-2 text-slate-600">{registro.matriz || '—'}</td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{ubicacion(registro)}</td>
                        <td className="px-3 py-2">
                          {/* 'Activa' es el literal real del dataset. */}
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${
                              registro.estado === 'Activa' ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          >
                            {registro.estado || 'Sin estado'}
                          </span>
                        </td>
                        <td
                          className="px-3 py-2 text-slate-500 max-w-xs truncate"
                          title={registro.metodo || 'No especificado'}
                        >
                          {registro.metodo || 'No especificado'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {paginas > 1 && (
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={pagina <= 1}
                  className="px-4 py-2 bg-white ring-1 ring-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Anterior
                </button>
                <p className="text-sm text-gray-500">
                  Página {pagina.toLocaleString('es-CO')} de {paginas.toLocaleString('es-CO')}
                </p>
                <button
                  onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
                  disabled={pagina >= paginas}
                  className="px-4 py-2 bg-white ring-1 ring-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente →
                </button>
              </div>
            )}
          </>
        )}
```

- [ ] **Step 5: Añadir el helper de ubicación**

El dataset trae `ciudad === departamento` en 8.631 registros (el 45%, todos `Bogotá, D.C.`), y hoy se pinta repetido. Añadir **fuera del componente**, junto a las demás constantes del módulo:

```ts
// En 8 631 registros (45%) ciudad y departamento son el mismo valor —todos
// 'Bogotá, D.C.'— y unirlos sin más produce «Bogotá, D.C., Bogotá, D.C.».
function ubicacion(registro: Laboratorio): string {
  const partes = [registro.ciudad, registro.departamento].map((p) => p.trim()).filter(Boolean);
  if (partes.length === 2 && partes[0].toLowerCase() === partes[1].toLowerCase()) return partes[0];
  return partes.join(', ') || '—';
}
```

- [ ] **Step 6: Verificar**

Run: `npm test --workspace=apps/laboratorios-ambientales`
Expected: PASS — 79 tests, ninguno roto.

Run: `npm run build --workspace=apps/laboratorios-ambientales`
Expected: exit 0.

Run: `npm run lint --workspace=apps/laboratorios-ambientales`
Expected: exit 0.

Run: `npm run build --workspace=apps/portal`
Expected: exit 0. **Es el build que se despliega: si este falla, nada más importa.**

- [ ] **Step 7: Commit**

```bash
git add apps/laboratorios-ambientales/src/pages/Buscador.tsx
git commit -m "feat(laboratorios): tabla paginada en el buscador

Sustituye la rejilla de 60 tarjetas por una tabla de 50 filas por página,
que da acceso a los 19 056 registros en vez de a 60. De paso, la ubicación
deja de repetirse en los 8 631 registros donde ciudad y departamento
coinciden (45% del dataset, todos Bogotá, D.C.)."
```

---

## Task 3: Verificación en el navegador

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Levantar el banco de pruebas**

La app no tiene entrada standalone (el portal es quien la monta, y su login exige `hub-api` + BD, que no están configurados en local). Los ficheros `harness.*` y `vite.harness.config.ts` de `apps/laboratorios-ambientales/` son un banco de pruebas desechable **que no se commitea**.

```bash
cd apps/laboratorios-ambientales
npx vite --config vite.harness.config.ts
```

Abrir `http://localhost:5199/harness.html` → «Buscador de Laboratorios».

- [ ] **Step 2: Comprobar la tabla**

- Se pintan **50 filas**, no 60 tarjetas.
- Encabezado: Laboratorio · Variable · Matriz · Ubicación · Estado · Método.
- El encabezado se queda fijo al hacer scroll vertical.
- La columna Método sale truncada a una línea; al pasar el ratón, el tooltip enseña el texto completo.
- **La ubicación de Bogotá sale una sola vez** (`Bogotá, D.C.`), no `Bogotá, D.C., Bogotá, D.C.`.
- Los badges de `Activa` salen **verdes**.

- [ ] **Step 3: Comprobar la paginación**

- El indicador dice «Página 1 de 382» y «Mostrando 1–50» sin filtros.
- `Anterior` está deshabilitado en la página 1; `Siguiente` en la 382.
- `Siguiente` avanza y cambia las filas.
- **Ir a la página 5, luego escribir en el buscador → vuelve a la página 1** y la tabla muestra resultados, no una pantalla en blanco. Es el caso que justifica el `useEffect`.
- Filtrar hasta dejar menos de 50 resultados → los controles de paginación desaparecen.
- Filtrar hasta 0 resultados → sale el estado vacío, sin controles.

- [ ] **Step 4: Anotar los resultados**

Si algo falla, **no cerrar el plan**: abrir la corrección como tarea antes de dar la vuelta a la rama.

---

## Self-Review

**Cobertura de la spec:**

| Requisito de la spec | Tarea |
|---|---|
| Tabla de 6 columnas | Task 2, Step 4 |
| Ubicación sin duplicar | Task 2, Step 5 |
| Método truncado + `title` | Task 2, Step 4 |
| Badge verde con `'Activa'` | Task 2, Step 4 |
| Encabezado `sticky` | Task 2, Step 4 |
| `overflow-x-auto` | Task 2, Step 4 |
| 50 filas/página | Task 1 (`PAGE_SIZE`) |
| Anterior/Siguiente deshabilitados en extremos | Task 2, Step 4 |
| Indicador «Página X de Y» | Task 2, Step 4 |
| Reseteo a página 1 al filtrar | Task 2, Step 2 |
| Página como estado local | Task 2, Step 2 |
| `totalPages` mínimo 1 | Task 1 |
| `pageSlice` acotado | Task 1 |
| Los 6 casos límite | Task 1 (tests) + Task 3 (navegador) |
| Dashboard sin tocar | No aparece en ninguna tarea ✅ |
