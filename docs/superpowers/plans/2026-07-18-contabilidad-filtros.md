# Contabilidad: filtros + presupuesto configurable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir a la app `contabilidad` filtros (año, cliente, estado de cobro, mes), una fila de totales de la vista filtrada, y presupuesto editable por año (solo admin), haciendo la app multi-año.

**Architecture:** El backend gana un parámetro `year`, expone los años disponibles y el facturado por año, y lee el presupuesto de una tabla nueva `portal.contabilidad_budget`. El contrato `Resumen` cambia (`presupuesto` nullable + `comparativos[]`). El frontend añade una barra de filtros (año recarga datos; cliente/estado/mes filtran en cliente), una fila de totales, y edición inline del presupuesto gated por rol admin.

**Tech Stack:** hub-api (Express + vitest + supertest), réplica Postgres vía `@algarpibe/zoho-sync`; frontend React 19 + Vite + lucide-react.

**Rama:** `feat/contabilidad-filtros`.

**Estado actual del código (verificado):**
- `apps/hub-api/src/contabilidad/domain.ts`: `Resumen` tiene `presupuesto2026/facturacion2025/facturacion2024/cumplimientoPct` (números) y constantes `PRESUPUESTO_2026/FACTURACION_2025/FACTURACION_2024`. `buildResumen(facturas)`.
- `apps/hub-api/src/contabilidad/source.ts`: `ANIO=2026` constante; `getContabilidadData(db)`; `FACTURAS_SQL` con exclusión AMI/OVI ya aplicada; `getCarteraOverrides`/`upsertCartera`.
- `apps/hub-api/src/contabilidad/router.ts`: GET `/contabilidad/facturas` (cached key `contabilidad:facturas`), PUT `/contabilidad/cartera/:invoiceNumber`. Usa `cached`, `clearCacheKey`, `requireAuth`, `requireApp('contabilidad')`, `getPayload`.
- `apps/hub-api/src/auth.ts`: `export async function requireAdmin(req,res,next)` (middleware async, como requireAuth).
- `apps/contabilidad/src/api.ts`: tipos espejo (`Resumen` con los campos viejos), `fetchContabilidad()` (sin params), `guardarCartera`.
- `apps/contabilidad/src/ResumenMensual.tsx`: usa `presupuesto2026/facturacion2025/facturacion2024/cumplimientoPct`.
- `apps/contabilidad/src/App.tsx`: carga con `fetchContabilidad()`, filtro de texto (cliente/OV/factura), edición de Cartera optimista.
- `apps/contabilidad/src/FacturasTable.tsx`, `format.ts`: sin cambios en este plan.

---

## Parte A — Backend

### Task 1: Migración de presupuesto por año

**Files:**
- Create: `apps/hub-api/src/users/migrations/008_contabilidad_budget.sql`
- Modify: `apps/hub-api/src/db.ts` (array `MIGRATIONS`)

- [ ] **Step 1: Crear la migración**

Create `apps/hub-api/src/users/migrations/008_contabilidad_budget.sql`:

```sql
-- Migration 008: presupuesto anual de la app Contabilidad (editable por admin).
-- Vive en el esquema `portal` (BD de usuarios, escribible). Idempotente.
CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.contabilidad_budget (
  year        INTEGER     PRIMARY KEY,
  presupuesto NUMERIC     NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID
);

-- Semilla del presupuesto 2026 (del Excel). No pisa si ya existe.
INSERT INTO portal.contabilidad_budget (year, presupuesto)
VALUES (2026, 4416000000)
ON CONFLICT (year) DO NOTHING;
```

- [ ] **Step 2: Registrar en db.ts** — añadir al final del array `MIGRATIONS`:

```ts
const MIGRATIONS = ['001_create_users.sql', '002_add_avatar.sql', '003_add_preferences.sql', '004_wo_sales_email.sql', '005_drop_wo_sales_recipients.sql', '006_wo_sales_email_sent.sql', '007_contabilidad_overrides.sql', '008_contabilidad_budget.sql'];
```

- [ ] **Step 3: Verificar build** — Run: `npm run build --workspace=apps/hub-api` (timeout 300000). Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/users/migrations/008_contabilidad_budget.sql apps/hub-api/src/db.ts
git commit -m "feat(contabilidad): migracion presupuesto por anio (portal.contabilidad_budget)"
```

---

### Task 2: Nuevo contrato de Resumen + buildResumen (TDD)

**Files:**
- Modify: `apps/hub-api/src/contabilidad/domain.ts`
- Modify: `apps/hub-api/src/contabilidad/domain.test.ts`

- [ ] **Step 1: Reescribir los tests de buildResumen** — en `apps/hub-api/src/contabilidad/domain.test.ts`:

Primero, quitar `PRESUPUESTO_2026` del import (la Task borra esa constante). El import debe quedar:

```ts
import {
  mapFacturaRow,
  dedupeByInvoiceNumber,
  withParticipacion,
  buildResumen,
  type FacturaRawRow,
} from './domain.js';
```

Luego reemplazar el bloque `describe('buildResumen', ...)` COMPLETO por:

```ts
describe('buildResumen', () => {
  const facturado = { 2024: 1000, 2025: 2000, 2026: 3000 };

  it('agrega facturación (subtotal) e IVA por mes y calcula acumulado', () => {
    const facturas = [
      mapFacturaRow(raw({ invoice_number: 'A', date: '2026-01-10', sub_total: 1000, iva: '190' }), new Map()),
      mapFacturaRow(raw({ invoice_number: 'B', date: '2026-01-20', sub_total: 2000, iva: '380' }), new Map()),
      mapFacturaRow(raw({ invoice_number: 'C', date: '2026-03-05', sub_total: 1000, iva: '190' }), new Map()),
    ];
    const r = buildResumen(facturas, 2026, 4416000000, facturado);
    expect(r.meses[0].facturacion).toBeCloseTo(3000, 2);
    expect(r.meses[0].iva).toBeCloseTo(570, 2);
    expect(r.meses[1].facturacion).toBe(0);
    expect(r.meses[0].acumulado).toBeCloseTo(3000, 2);
    expect(r.meses[2].acumulado).toBeCloseTo(4000, 2);
  });

  it('calcula cumplimiento cuando hay presupuesto', () => {
    const facturas = [mapFacturaRow(raw({ sub_total: 1000 }), new Map())];
    const r = buildResumen(facturas, 2026, 4416000000, facturado);
    expect(r.totalFacturadoSinIva).toBe(1000);
    expect(r.presupuesto).toBe(4416000000);
    expect(r.cumplimientoPct).toBeCloseTo(1000 / 4416000000, 12);
  });

  it('presupuesto null -> cumplimiento null (sin dividir)', () => {
    const r = buildResumen([mapFacturaRow(raw({ sub_total: 1000 }), new Map())], 2027, null, facturado);
    expect(r.presupuesto).toBeNull();
    expect(r.cumplimientoPct).toBeNull();
  });

  it('comparativos = años anteriores con datos, de mayor a menor', () => {
    const r = buildResumen([], 2026, null, facturado);
    expect(r.comparativos).toEqual([
      { anio: 2025, facturado: 2000 },
      { anio: 2024, facturado: 1000 },
    ]);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar** — Run: `npm run test --workspace=apps/hub-api -- domain`. Expected: FAIL (buildResumen firma vieja / campos `presupuesto`/`comparativos` no existen).

- [ ] **Step 3: Actualizar domain.ts** — en `apps/hub-api/src/contabilidad/domain.ts`:

(a) Eliminar las tres constantes de presupuesto (ya no se usan aquí):

```ts
// BORRAR estas líneas:
export const PRESUPUESTO_2026 = 4_416_000_000;
export const FACTURACION_2025 = 4_079_226_260;
export const FACTURACION_2024 = 2_423_070_754;
```

(b) Reemplazar la interfaz `Resumen` COMPLETA por:

```ts
export interface Resumen {
  meses: ResumenMes[];
  totalFacturadoSinIva: number;
  totalIva: number;
  presupuesto: number | null;
  cumplimientoPct: number | null; // null si no hay presupuesto
  comparativos: { anio: number; facturado: number }[]; // años anteriores, mayor→menor
}
```

(c) Reemplazar la función `buildResumen` COMPLETA por:

```ts
/**
 * Resumen mensual/anual del año `anio`. El detalle mensual usa el SUBTOTAL sin IVA
 * (f.total). `presupuesto` viene de la config por año (null si no hay). Los
 * comparativos son el facturado de años anteriores presentes en `facturadoPorAnio`.
 */
export function buildResumen(
  facturas: FacturaContable[],
  anio: number,
  presupuesto: number | null,
  facturadoPorAnio: Record<number, number>,
): Resumen {
  const meses: ResumenMes[] = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    facturacion: 0,
    iva: 0,
    acumulado: 0,
  }));
  for (const f of facturas) {
    const m = Number(f.fechaFactura.slice(5, 7));
    if (m >= 1 && m <= 12) {
      meses[m - 1].facturacion += f.total;
      meses[m - 1].iva += f.iva;
    }
  }
  let acc = 0;
  for (const mes of meses) {
    acc += mes.facturacion;
    mes.acumulado = acc;
  }
  const totalFacturadoSinIva = meses.reduce((a, m) => a + m.facturacion, 0);
  const totalIva = meses.reduce((a, m) => a + m.iva, 0);
  const comparativos = Object.entries(facturadoPorAnio)
    .map(([y, facturado]) => ({ anio: Number(y), facturado }))
    .filter((c) => c.anio < anio)
    .sort((a, b) => b.anio - a.anio);
  return {
    meses,
    totalFacturadoSinIva,
    totalIva,
    presupuesto,
    cumplimientoPct: presupuesto && presupuesto > 0 ? totalFacturadoSinIva / presupuesto : null,
    comparativos,
  };
}
```

- [ ] **Step 4: Ejecutar y ver pasar** — Run: `npm run test --workspace=apps/hub-api -- domain`. Expected: PASS (todos). Si algún otro test del archivo referenciaba las constantes borradas, actualízalo.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/contabilidad/domain.ts apps/hub-api/src/contabilidad/domain.test.ts
git commit -m "feat(contabilidad): Resumen con presupuesto nullable y comparativos por anio"
```

---

### Task 3: source.ts — año, años disponibles, presupuesto desde BD

**Files:**
- Modify: `apps/hub-api/src/contabilidad/source.ts`

- [ ] **Step 1: Reescribir source.ts** — reemplazar el contenido de `apps/hub-api/src/contabilidad/source.ts` desde la línea de `const ANIO = 2026;` hasta el final del archivo por:

```ts
// Rango del año contable (parametrizable). Antes fijo en 2026.
function rango(anio: number): [string, string] {
  return [`${anio}-01-01`, `${anio + 1}-01-01`];
}

// (FACTURAS_SQL se mantiene EXACTAMENTE igual — no lo toques; solo cambian los
//  parámetros de fecha que se le pasan.)

// Facturado (subtotal) por año, excluyendo las internas AMI-/OVI-. Sirve para el
// selector de años y para los comparativos del resumen.
const FACTURADO_POR_ANIO_SQL = `
  SELECT date_part('year', i.date)::int AS anio,
         SUM(i.sub_total)               AS facturado
    FROM books.invoices i
   WHERE i.invoice_number NOT ILIKE 'AMI-%'
     AND COALESCE(i.reference_number, '') NOT ILIKE 'OVI-%'
   GROUP BY 1
   ORDER BY 1`;

/** Lee el mapa de overrides de cartera (invoice_number -> texto). */
export async function getCarteraOverrides(db: Pool): Promise<Map<string, string>> {
  const { rows } = await db.query(
    `SELECT invoice_number, cartera FROM portal.contabilidad_overrides WHERE cartera IS NOT NULL`,
  );
  const m = new Map<string, string>();
  for (const r of rows as { invoice_number: string; cartera: string }[]) {
    m.set(r.invoice_number, r.cartera);
  }
  return m;
}

/** Upsert de la cartera de una factura. `updatedBy` es el user_id (UUID) o null. */
export async function upsertCartera(
  db: Pool,
  invoiceNumber: string,
  cartera: string,
  updatedBy: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO portal.contabilidad_overrides (invoice_number, cartera, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (invoice_number)
     DO UPDATE SET cartera = EXCLUDED.cartera, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [invoiceNumber, cartera, updatedBy],
  );
}

/** Presupuesto de un año (null si no está configurado). */
export async function getBudget(db: Pool, anio: number): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT presupuesto FROM portal.contabilidad_budget WHERE year = $1`,
    [anio],
  );
  if (!rows.length) return null;
  const n = Number((rows[0] as { presupuesto: unknown }).presupuesto);
  return Number.isFinite(n) ? n : null;
}

/** Upsert del presupuesto de un año. */
export async function upsertBudget(
  db: Pool,
  anio: number,
  presupuesto: number,
  updatedBy: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO portal.contabilidad_budget (year, presupuesto, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (year)
     DO UPDATE SET presupuesto = EXCLUDED.presupuesto, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [anio, presupuesto, updatedBy],
  );
}

/** Facturado por año (para selector + comparativos). */
async function getFacturadoPorAnio(db: Pool): Promise<Record<number, number>> {
  const { rows } = await db.query(FACTURADO_POR_ANIO_SQL);
  const out: Record<number, number> = {};
  for (const r of rows as { anio: number; facturado: unknown }[]) {
    out[Number(r.anio)] = Number(r.facturado) || 0;
  }
  return out;
}

/** Facturas del año + resumen + años disponibles, con la cartera fusionada. */
export async function getContabilidadData(db: Pool, anio: number): Promise<ContabilidadData> {
  const [desde, hasta] = rango(anio);
  const [{ rows }, overrides, presupuesto, facturadoPorAnio] = await Promise.all([
    db.query(FACTURAS_SQL, [desde, hasta]),
    getCarteraOverrides(db),
    getBudget(db, anio),
    getFacturadoPorAnio(db),
  ]);
  const dedup = dedupeByInvoiceNumber(rows as FacturaRawRow[]);
  const facturas = withParticipacion(dedup.map((r) => mapFacturaRow(r, overrides)));
  const resumen = buildResumen(facturas, anio, presupuesto, facturadoPorAnio);
  const aniosDisponibles = Object.keys(facturadoPorAnio).map(Number).sort((a, b) => b - a);
  return { facturas, resumen, anioActual: anio, aniosDisponibles };
}
```

Y actualizar la interfaz `ContabilidadData` (arriba en el mismo archivo) a:

```ts
export interface ContabilidadData {
  facturas: FacturaContable[];
  resumen: Resumen;
  anioActual: number;
  aniosDisponibles: number[];
}
```

(Deja intactos los imports y `FACTURAS_SQL`. Solo se elimina el `const ANIO/DESDE/HASTA` y se reemplaza lo de abajo.)

- [ ] **Step 2: Verificar build** — Run: `npm run build --workspace=apps/hub-api` (timeout 300000). Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/contabilidad/source.ts
git commit -m "feat(contabilidad): year param, anios disponibles y presupuesto desde BD"
```

---

### Task 4: router.ts — year en GET + PUT presupuesto (admin) (TDD)

**Files:**
- Modify: `apps/hub-api/src/contabilidad/router.ts`
- Modify: `apps/hub-api/src/contabilidad/router.test.ts`

- [ ] **Step 1: Añadir tests** — en `apps/hub-api/src/contabilidad/router.test.ts`:

(a) El `fakePool` actual devuelve `{ rows: [] }` para toda query — sigue sirviendo (getBudget → sin filas → null; facturadoPorAnio → {}).

(b) Añadir, dentro del `describe('GET /api/contabilidad/facturas', ...)`, un caso:

```ts
  it('200 devuelve anioActual y aniosDisponibles', async () => {
    const res = await request(appConPool(fakePool()))
      .get('/api/contabilidad/facturas?year=2025')
      .set('Authorization', `Bearer ${token(['contabilidad'])}`);
    expect(res.status).toBe(200);
    expect(res.body.anioActual).toBe(2025);
    expect(Array.isArray(res.body.aniosDisponibles)).toBe(true);
    expect(res.body.resumen.cumplimientoPct).toBeNull(); // sin presupuesto en fakePool
  });
```

(c) Añadir un `describe` nuevo para el presupuesto. `requireAdmin` consulta la BD para validar rol: con token legacy (sin user_id) `requireAdmin` NO puede confirmar admin, así que probamos el 403 del no-admin con un token normal, y el 200 con un token cuyo `role: 'admin'` — PERO `requireAdmin` revalida contra BD. Para no montar BD, verificamos SOLO el gating de no-admin (403) y la validación del body; el happy-path admin se cubre en la verificación manual (Task 12). Añadir:

```ts
describe('PUT /api/contabilidad/budget/:year', () => {
  it('403 si no es admin', async () => {
    const res = await request(appConPool(fakePool()))
      .put('/api/contabilidad/budget/2027')
      .set('Authorization', `Bearer ${token(['contabilidad'], 'reader')}`)
      .send({ presupuesto: 1000 });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar** — Run: `npm run test --workspace=apps/hub-api -- contabilidad/router`. Expected: FAIL (nuevos casos: falta year/anioActual y la ruta budget).

- [ ] **Step 3: Actualizar router.ts** — reemplazar el cuerpo de `createContabilidadRouter` en `apps/hub-api/src/contabilidad/router.ts`:

(a) Añadir imports: `requireAdmin` desde `../auth.js` y `upsertBudget` desde `./source.js`:

```ts
import { requireAuth, requireApp, requireAdmin, getPayload } from '../auth.js';
import { getContabilidadData, upsertCartera, upsertBudget } from './source.js';
```

(b) Añadir constante y helper de año arriba del factory:

```ts
const ANIO_DEFECTO = 2026;
function parseAnio(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return null;
  return n;
}
```

(c) Reemplazar el handler GET y añadir el PUT budget:

```ts
  router.get('/contabilidad/facturas', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const anio = req.query.year === undefined ? ANIO_DEFECTO : parseAnio(req.query.year);
      if (anio === null) return void res.status(400).json({ error: 'year inválido' });
      const data = await cached(`${CACHE_KEY}:${anio}`, () => getContabilidadData(db, anio));
      res.json(data);
    } catch (e) {
      sendError(res, e, 'contabilidad_facturas');
    }
  });

  // ... (el PUT /contabilidad/cartera/:invoiceNumber se mantiene igual) ...

  router.put('/contabilidad/budget/:year', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const anio = parseAnio(req.params.year);
      if (anio === null) return void res.status(400).json({ error: 'year inválido' });
      const presupuesto = (req.body as { presupuesto?: unknown }).presupuesto;
      if (typeof presupuesto !== 'number' || !Number.isFinite(presupuesto) || presupuesto < 0) {
        return void res.status(400).json({ error: 'presupuesto (number >= 0) requerido' });
      }
      const userId = getPayload(req)?.user_id ?? null;
      await upsertBudget(db, anio, presupuesto, userId ? String(userId) : null);
      clearCacheKey(`${CACHE_KEY}:${anio}`);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, 'contabilidad_budget');
    }
  });
```

Nota: el `PUT /contabilidad/cartera/:invoiceNumber` usa `clearCacheKey(CACHE_KEY)` hoy; cámbialo a invalidar TODAS las claves por año. Como no conocemos el año de la factura ahí, la forma simple es usar `clearCache()` en el handler de cartera (invalida todo — la cartera cambia poco). Sustituir en el handler de cartera `clearCacheKey(CACHE_KEY);` por `clearCache();` y ajustar el import a `import { cached, clearCache, clearCacheKey } from '../cache.js';`.

- [ ] **Step 4: Ejecutar y ver pasar** — Run: `npm run test --workspace=apps/hub-api -- contabilidad`. Expected: PASS (domain + router).

- [ ] **Step 5: Build + commit**

```bash
npm run build --workspace=apps/hub-api
git add apps/hub-api/src/contabilidad/router.ts apps/hub-api/src/contabilidad/router.test.ts
git commit -m "feat(contabilidad): GET con year + PUT presupuesto (admin)"
```

---

## Parte B — Frontend

### Task 5: api.ts — contrato nuevo + fetch/save

**Files:**
- Modify: `apps/contabilidad/src/api.ts`

- [ ] **Step 1: Actualizar api.ts**

(a) Reemplazar la interfaz `Resumen` y `ContabilidadData` por:

```ts
export interface Resumen {
  meses: ResumenMes[];
  totalFacturadoSinIva: number;
  totalIva: number;
  presupuesto: number | null;
  cumplimientoPct: number | null;
  comparativos: { anio: number; facturado: number }[];
}

export interface ContabilidadData {
  facturas: FacturaContable[];
  resumen: Resumen;
  anioActual: number;
  aniosDisponibles: number[];
}
```

(b) `fetchContabilidad` acepta año:

```ts
export async function fetchContabilidad(year?: number): Promise<ContabilidadData> {
  const qs = year ? `?year=${year}` : '';
  const res = await fetch(`${API_BASE}/api/contabilidad/facturas${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as ContabilidadData;
}
```

(c) Añadir guardado de presupuesto y un helper de rol admin (decodifica el JWT igual que el portal):

```ts
/** Guarda el presupuesto de un año (solo admin en el backend). */
export async function guardarPresupuesto(year: number, presupuesto: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/contabilidad/budget/${year}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ presupuesto }),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}

/** True si el JWT en localStorage tiene rol admin (solo para gating de UX). */
export function esAdmin(): boolean {
  const t = localStorage.getItem('ambientalia_token');
  if (!t) return false;
  try {
    const payload = JSON.parse(atob(t.split('.')[1] || ''));
    return payload.role === 'admin';
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verificar build** — Run: `npm run build --workspace=apps/contabilidad`. **Fallará** en `ResumenMensual.tsx` (usa campos viejos) — es esperado; se arregla en Task 6. Confirma que el error es SOLO de ResumenMensual y no de api.ts.

- [ ] **Step 3: Commit** (parcial; el build se restablece en Task 6)

```bash
git add apps/contabilidad/src/api.ts
git commit -m "feat(contabilidad): api con year, presupuesto editable y contrato de resumen nuevo"
```

---

### Task 6: ResumenMensual.tsx — contrato nuevo + presupuesto editable (admin)

**Files:**
- Modify: `apps/contabilidad/src/ResumenMensual.tsx`

- [ ] **Step 1: Reemplazar ResumenMensual.tsx COMPLETO** por:

```tsx
import { useState } from 'react';
import type { Resumen } from './api';
import { formatCOP, formatPct } from './format';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  resumen: Resumen;
  anio: number;
  puedeEditar: boolean; // rol admin
  onGuardarPresupuesto: (presupuesto: number) => void;
  guardandoPresupuesto: boolean;
}

export default function ResumenMensual({ resumen, anio, puedeEditar, onGuardarPresupuesto, guardandoPresupuesto }: Props) {
  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Resumen {anio}</h2>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-2 py-2 text-left font-semibold">Concepto</th>
              {MESES.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-semibold">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="px-2 py-1 font-medium">Facturación</td>
              {resumen.meses.map((m) => (
                <td key={m.mes} className="px-2 py-1 text-right tabular-nums">{formatCOP(m.facturacion)}</td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-1 font-medium">Acumulado</td>
              {resumen.meses.map((m) => (
                <td key={m.mes} className="px-2 py-1 text-right tabular-nums">{formatCOP(m.acumulado)}</td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-1 font-medium">IVA</td>
              {resumen.meses.map((m) => (
                <td key={m.mes} className="px-2 py-1 text-right tabular-nums">{formatCOP(m.iva)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi label={`Facturado ${anio} (sin IVA)`} value={formatCOP(resumen.totalFacturadoSinIva)} />
        <PresupuestoKpi
          anio={anio}
          presupuesto={resumen.presupuesto}
          puedeEditar={puedeEditar}
          guardando={guardandoPresupuesto}
          onGuardar={onGuardarPresupuesto}
        />
        <Kpi label="Cumplimiento" value={resumen.cumplimientoPct === null ? '—' : formatPct(resumen.cumplimientoPct)} />
        <Kpi label={`IVA total ${anio}`} value={formatCOP(resumen.totalIva)} />
        {resumen.comparativos.map((c) => (
          <Kpi key={c.anio} label={`Facturación ${c.anio}`} value={formatCOP(c.facturado)} />
        ))}
      </div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-soft">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{value}</div>
    </div>
  );
}

function PresupuestoKpi({
  anio, presupuesto, puedeEditar, guardando, onGuardar,
}: {
  anio: number; presupuesto: number | null; puedeEditar: boolean; guardando: boolean; onGuardar: (n: number) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');

  if (editando) {
    return (
      <div className="rounded-2xl border border-blue-300 bg-white p-4 shadow-soft">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">Presupuesto {anio}</div>
        <input
          autoFocus
          type="number"
          defaultValue={presupuesto ?? ''}
          onChange={(e) => setValor(e.target.value)}
          disabled={guardando}
          className="mt-1 w-full rounded border border-gray-300 px-1 py-0.5 text-lg tabular-nums focus:border-blue-400 focus:outline-none"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => { const n = Number(valor); if (Number.isFinite(n) && n >= 0) onGuardar(n); setEditando(false); }}
            className="rounded bg-blue-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-600"
          >Guardar</button>
          <button onClick={() => setEditando(false)} className="rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800">Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">Presupuesto {anio}</div>
        {puedeEditar && (
          <button onClick={() => { setValor(String(presupuesto ?? '')); setEditando(true); }} className="text-[11px] text-blue-500 hover:underline">
            editar
          </button>
        )}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
        {presupuesto === null ? 'sin configurar' : formatCOP(presupuesto)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar build** — Run: `npm run build --workspace=apps/contabilidad`. Expected: OK (ya no usa campos viejos). App.tsx aún llama a `ResumenMensual` con props viejas → **fallará por props**; se arregla en Task 7. Confirma que el único error restante es en App.tsx.

- [ ] **Step 3: Commit**

```bash
git add apps/contabilidad/src/ResumenMensual.tsx
git commit -m "feat(contabilidad): resumen con comparativos y presupuesto editable inline (admin)"
```

---

### Task 7: App.tsx — barra de filtros, totales de la vista, año y presupuesto

**Files:**
- Modify: `apps/contabilidad/src/App.tsx`

- [ ] **Step 1: Reemplazar App.tsx COMPLETO** por:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, Search, Landmark } from 'lucide-react';
import { fetchContabilidad, guardarCartera, guardarPresupuesto, esAdmin, type ContabilidadData, type FacturaContable } from './api';
import { formatCOP } from './format';
import FacturasTable from './FacturasTable';
import ResumenMensual from './ResumenMensual';

type Estado = 'todas' | 'pagada' | 'saldo' | 'vencida';

function estadoDe(f: FacturaContable, hoy: string): Estado {
  if (f.porCobrar <= 0) return 'pagada';
  if (f.fechaVencimiento && f.fechaVencimiento < hoy) return 'vencida';
  return 'saldo';
}

export default function App() {
  const [data, setData] = useState<ContabilidadData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [anio, setAnio] = useState(2026);
  const [filtro, setFiltro] = useState('');
  const [cliente, setCliente] = useState('');
  const [estado, setEstado] = useState<Estado>('todas');
  const [mes, setMes] = useState(0); // 0 = todos
  const [guardando, setGuardando] = useState<string | null>(null);
  const [guardandoPpto, setGuardandoPpto] = useState(false);

  const puedeEditar = esAdmin();
  const hoy = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetchContabilidad(anio)
      .then((d) => vivo && (setData(d), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [anio]);

  const clientes = useMemo(
    () => (data ? [...new Set(data.facturas.map((f) => f.razonSocial))].sort((a, b) => a.localeCompare(b, 'es')) : []),
    [data],
  );

  const facturasFiltradas = useMemo(() => {
    if (!data) return [];
    const q = filtro.trim().toLowerCase();
    return data.facturas.filter((f) => {
      if (cliente && f.razonSocial !== cliente) return false;
      if (estado !== 'todas' && estadoDe(f, hoy) !== estado) return false;
      if (mes && Number(f.fechaFactura.slice(5, 7)) !== mes) return false;
      if (q && !(f.razonSocial.toLowerCase().includes(q) || f.ov.toLowerCase().includes(q) || f.invoiceNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, filtro, cliente, estado, mes, hoy]);

  const totales = useMemo(() => {
    return facturasFiltradas.reduce(
      (a, f) => ({ n: a.n + 1, total: a.total + f.totalConIva, cobrado: a.cobrado + f.cobrado, porCobrar: a.porCobrar + f.porCobrar }),
      { n: 0, total: 0, cobrado: 0, porCobrar: 0 },
    );
  }, [facturasFiltradas]);

  async function onEditarCartera(invoiceNumber: string, cartera: string) {
    if (!data) return;
    const anterior = data.facturas.find((f) => f.invoiceNumber === invoiceNumber)?.cartera ?? '';
    setData({ ...data, facturas: data.facturas.map((f) => (f.invoiceNumber === invoiceNumber ? { ...f, cartera } : f)) });
    setGuardando(invoiceNumber);
    try {
      await guardarCartera(invoiceNumber, cartera);
    } catch (e) {
      setData((d) => (d ? { ...d, facturas: d.facturas.map((f) => (f.invoiceNumber === invoiceNumber ? { ...f, cartera: anterior } : f)) } : d));
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  }

  async function onGuardarPresupuesto(presupuesto: number) {
    if (!data) return;
    const anterior = data.resumen.presupuesto;
    const cumpl = presupuesto > 0 ? data.resumen.totalFacturadoSinIva / presupuesto : null;
    setData({ ...data, resumen: { ...data.resumen, presupuesto, cumplimientoPct: cumpl } });
    setGuardandoPpto(true);
    try {
      await guardarPresupuesto(anio, presupuesto);
    } catch (e) {
      setData((d) => (d ? { ...d, resumen: { ...d.resumen, presupuesto: anterior } } : d));
      setError((e as Error).message);
    } finally {
      setGuardandoPpto(false);
    }
  }

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';

  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      <header className="mb-6 flex items-center gap-3">
        <Landmark className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Contabilidad — Facturación</h1>
          <p className="text-sm text-gray-500">Datos en vivo desde Zoho. La columna Cartera se guarda al salir de la celda.</p>
        </div>
      </header>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Barra de filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={selCls} value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
          {(data?.aniosDisponibles?.length ? data.aniosDisponibles : [anio]).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select className={selCls} value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos los clientes</option>
          {clientes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={selCls} value={estado} onChange={(e) => setEstado(e.target.value as Estado)}>
          <option value="todas">Todos los estados</option>
          <option value="pagada">Pagadas</option>
          <option value="saldo">Con saldo</option>
          <option value="vencida">Vencidas</option>
        </select>
        <select className={selCls} value={mes} onChange={(e) => setMes(Number(e.target.value))}>
          <option value={0}>Todos los meses</option>
          {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar cliente, OV o factura…" className="w-64 rounded-xl border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-blue-400 focus:outline-none" />
        </div>
      </div>

      {cargando && (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Cargando facturas…</div>
      )}

      {data && !cargando && (
        <>
          {/* Totales de la vista filtrada */}
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span className="text-gray-500">{totales.n} facturas</span>
            <span className="text-gray-700">Total: <b className="tabular-nums">{formatCOP(totales.total)}</b></span>
            <span className="text-gray-700">Cobrado: <b className="tabular-nums">{formatCOP(totales.cobrado)}</b></span>
            <span className="text-gray-700">Por cobrar: <b className="tabular-nums">{formatCOP(totales.porCobrar)}</b></span>
          </div>

          <FacturasTable facturas={facturasFiltradas} onEditarCartera={onEditarCartera} guardando={guardando} />
          <ResumenMensual
            resumen={data.resumen}
            anio={data.anioActual}
            puedeEditar={puedeEditar}
            onGuardarPresupuesto={onGuardarPresupuesto}
            guardandoPresupuesto={guardandoPpto}
          />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verificar build** — Run: `npm run build --workspace=apps/contabilidad`. Expected: OK, sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/contabilidad/src/App.tsx
git commit -m "feat(contabilidad): barra de filtros, totales de la vista y selector de anio"
```

---

## Parte C — Verificación

### Task 8: Build/test completo + verificación manual

- [ ] **Step 1: Backend** — Run: `npm run build --workspace=apps/hub-api && npm run test --workspace=apps/hub-api -- contabilidad`. Expected: build limpio; tests de contabilidad (domain + router) en verde.

- [ ] **Step 2: Frontend + portal** — Run: `npm run build --workspace=apps/contabilidad && npm run build --workspace=apps/portal`. Expected: ambos compilan.

- [ ] **Step 3: Verificación contra BD real (tras desplegar hub-api)** — el usuario ejecuta (siempre `\c zoho-hub`):

```sql
-- años con facturación (deben poblar el selector)
SELECT date_part('year', date)::int AS anio, count(*) AS facturas, to_char(SUM(sub_total),'FM999,999,999,999') AS facturado
  FROM books.invoices
 WHERE invoice_number NOT ILIKE 'AMI-%' AND COALESCE(reference_number,'') NOT ILIKE 'OVI-%'
 GROUP BY 1 ORDER BY 1 DESC;

-- el presupuesto sembrado
SELECT * FROM portal.contabilidad_budget;
```

- [ ] **Step 4: E2E manual en el portal** (tras desplegar hub-api + portal):
  - El selector de **Año** solo muestra años con datos; cambiarlo recarga tabla + resumen de ese año.
  - **Cliente/Estado/Mes** filtran la tabla y la fila de totales cuadra con lo visible.
  - "Vencidas" muestra solo facturas con saldo y vencimiento pasado.
  - Como **admin**: aparece "editar" en el presupuesto; editarlo persiste y recalcula el cumplimiento. Como no-admin: no aparece "editar" y el `PUT` responde 403.
  - En un año sin presupuesto: la tarjeta dice "sin configurar" y Cumplimiento "—".

---

## Notas para el implementador

- El contrato `Resumen` cambia; hay que tocar backend (domain/source/tests) y frontend (api/ResumenMensual/App) de forma coordinada — por eso Tasks 5-7 dejan el build roto de forma transitoria hasta Task 7 (es intencional y está anotado en cada paso).
- `requireAdmin` revalida el rol contra la BD, así que el happy-path de edición de presupuesto no se testea con supertest (solo el 403 del no-admin); se cubre en la verificación manual (Task 8).
- No tocar `FACTURAS_SQL`, `FacturasTable.tsx`, `format.ts`, ni el mapeo de facturas (`mapFacturaRow`).
- El usuario usa **PowerShell 5.1**: los comandos de deploy/push van sin `&&`.
