# App Contabilidad (Facturación 2026) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el Excel `Contabilidad_muestra.xlsx` por una app viva dentro del portal: una sola vista con la tabla de facturación 2026 (datos automáticos de Zoho) + resumen mensual vs presupuesto, y la columna **Cartera** editable en línea.

**Architecture:** Backend nuevo en `hub-api` (`GET /api/contabilidad/facturas` + `PUT /api/contabilidad/cartera/:invoiceNumber`), protegido con `requireAuth` + `requireApp('contabilidad')`, que lee `books.invoices` de la réplica Postgres de Zoho, fusiona los overrides de Cartera de una tabla nueva escribible (`portal.contabilidad_overrides`), y calcula el resumen mensual. Frontend React/Vite en `apps/contabilidad/` que el portal importa como componente lazy (mismo patrón que WO-sales). Toda la lógica de negocio (mapeo, dedupe, %participación, resumen) vive en funciones puras testeadas con vitest; el SQL es una capa fina que se verifica contra la BD real.

**Tech Stack:** hub-api (Express + TypeScript + vitest + supertest), réplica Postgres `zoho-hub` vía `@algarpibe/zoho-sync`; frontend React 19 + Vite 7 + lucide-react (Tailwind lo compila el portal).

**Contrato de datos confirmado (factura Zoho real 2026):**
- IVA = `raw->>'tax_total'` (COP). Subtotal = columna `sub_total`. Total con IVA = columna `total`.
- Por cobrar = `raw->>'balance'` (con fallback a `total`). Retenciones = `raw->>'tax_amount_withheld'`.
- Cobrado% = `1 − balance/total`. Cobrado$ = `total − balance − retenciones`.
- OV = columna `reference_number`. Trato = `crm.deals.deal_name` vía `raw->>'zcrm_potential_id' = crm.deals.id` (a menudo vacío). Ticket = `desk.tickets.number` vía `desk.tickets.orden_venta = reference_number` (a menudo vacío). QT = no replicado → vacío.
- **De-duplicar por `invoice_number`** (incidente facturas fantasma), quedándose con el `synced_at` más reciente.
- Regla de la casa: numéricos de `raw` se leen como **texto** (`raw->>'x'`) y se castean en TS (un `::numeric` con `"12.5%"` aborta la consulta).

**Presupuesto/comparativos sembrados (constantes, extraídos del Excel):**
- Pto 2026 (meta anual, sin IVA): `4_416_000_000`
- Facturación 2025: `4_079_226_260`
- Facturación 2024: `2_423_070_754`

---

## Parte A — Backend (hub-api)

### Task 1: Migración de la tabla de overrides de Cartera

**Files:**
- Create: `apps/hub-api/src/users/migrations/007_contabilidad_overrides.sql`
- Modify: `apps/hub-api/src/db.ts` (array `MIGRATIONS`)

- [ ] **Step 1: Crear la migración SQL**

Create `apps/hub-api/src/users/migrations/007_contabilidad_overrides.sql`:

```sql
-- Migration 007: overrides manuales de la app Contabilidad.
-- Guarda datos que Zoho no tiene, por ahora solo `cartera` (texto libre) por
-- número de factura. Vive en el esquema `portal` (BD de usuarios, escribible),
-- NO en la réplica read-only de Zoho. Idempotente: safe en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.contabilidad_overrides (
  invoice_number TEXT        PRIMARY KEY,
  cartera        TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by     UUID
);
```

- [ ] **Step 2: Registrar la migración en db.ts**

En `apps/hub-api/src/db.ts`, añadir el nombre del archivo al final del array `MIGRATIONS` (hay auto-discovery: es una lista literal):

```ts
const MIGRATIONS = ['001_create_users.sql', '002_add_avatar.sql', '003_add_preferences.sql', '004_wo_sales_email.sql', '005_drop_wo_sales_recipients.sql', '006_wo_sales_email_sent.sql', '007_contabilidad_overrides.sql'];
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run build --workspace=apps/hub-api`
Expected: sin errores de TypeScript.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/users/migrations/007_contabilidad_overrides.sql apps/hub-api/src/db.ts
git commit -m "feat(contabilidad): migracion tabla portal.contabilidad_overrides (cartera)"
```

---

### Task 2: Lógica de dominio pura (mapeo, dedupe, %participación, resumen) — TDD

Toda la aritmética del Excel vive aquí, sin BD, testeada. Sigue el patrón de `salesOrders.ts` (función pura + test con filas de ejemplo).

**Files:**
- Create: `apps/hub-api/src/contabilidad/domain.ts`
- Test: `apps/hub-api/src/contabilidad/domain.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `apps/hub-api/src/contabilidad/domain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  mapFacturaRow,
  dedupeByInvoiceNumber,
  withParticipacion,
  buildResumen,
  PRESUPUESTO_2026,
  type FacturaRawRow,
} from './domain.js';

// Fila cruda mínima (como la devuelve el SQL). Campos irrelevantes por defecto.
const raw = (over: Partial<FacturaRawRow>): FacturaRawRow => ({
  invoice_number: 'AM0001',
  reference_number: 'OV-2026-001',
  customer_name: 'ACME',
  date: '2026-01-15',
  due_date: '2026-02-15',
  status: 'paid',
  sub_total: 1000,
  total: 1190,
  iva: '190',
  balance: '0',
  retenciones: '0',
  deal_name: null,
  ticket_number: null,
  synced_at: '2026-01-16T00:00:00Z',
  ...over,
});

describe('mapFacturaRow', () => {
  it('mapea y calcula total+iva, cobrado, cobrado% y por cobrar (factura saldada)', () => {
    // Fila 3 del Excel: sub 1523592, iva 289482.48, total 1813074.48,
    // retención 54910.26, balance 0 -> cobrado% 1, cobrado = total-balance-ret.
    const f = mapFacturaRow(
      raw({ sub_total: 1523592, total: 1813074.48, iva: '289482.48', balance: '0', retenciones: '54910.26' }),
      new Map(),
    );
    expect(f.total).toBe(1523592);
    expect(f.iva).toBeCloseTo(289482.48, 2);
    expect(f.totalConIva).toBeCloseTo(1813074.48, 2);
    expect(f.porCobrar).toBe(0);
    expect(f.cobradoPct).toBeCloseTo(1, 6);
    expect(f.cobrado).toBeCloseTo(1758164.22, 2);
    expect(f.retenciones).toBeCloseTo(54910.26, 2);
  });

  it('cobrado% = 1 - balance/total cuando hay saldo pendiente', () => {
    // Excel fila IHA: total 15404550, balance 0.3 -> cobrado% ~0.99999998
    const f = mapFacturaRow(raw({ total: 15404550, balance: '0.3', retenciones: '642848.7' }), new Map());
    expect(f.cobradoPct).toBeCloseTo(0.99999998, 8);
    expect(f.porCobrar).toBeCloseTo(0.3, 6);
  });

  it('total 0 no divide por cero (cobrado% = 0)', () => {
    const f = mapFacturaRow(raw({ total: 0, sub_total: 0, iva: '0', balance: '0' }), new Map());
    expect(f.cobradoPct).toBe(0);
  });

  it('valores no numéricos de raw cuentan como 0, sin romper', () => {
    const f = mapFacturaRow(raw({ iva: 'N/A', balance: '', retenciones: null }), new Map());
    expect(f.iva).toBe(0);
    expect(f.porCobrar).toBe(0);
    expect(f.retenciones).toBe(0);
  });

  it('fusiona la cartera del override por invoice_number', () => {
    const f = mapFacturaRow(raw({ invoice_number: 'AM0009' }), new Map([['AM0009', 'En gestión']]));
    expect(f.cartera).toBe('En gestión');
  });

  it('cartera vacía cuando no hay override', () => {
    expect(mapFacturaRow(raw({ invoice_number: 'AM0009' }), new Map()).cartera).toBe('');
  });
});

describe('dedupeByInvoiceNumber', () => {
  it('elimina facturas fantasma duplicadas, se queda con el synced_at más reciente', () => {
    const rows = [
      raw({ invoice_number: 'AM1', total: 100, synced_at: '2026-01-01T00:00:00Z' }),
      raw({ invoice_number: 'AM1', total: 200, synced_at: '2026-02-01T00:00:00Z' }),
      raw({ invoice_number: 'AM2', total: 300, synced_at: '2026-01-01T00:00:00Z' }),
    ];
    const out = dedupeByInvoiceNumber(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.invoice_number === 'AM1')!.total).toBe(200);
  });
});

describe('withParticipacion', () => {
  it('asigna %participación = totalConIva de la factura / suma total', () => {
    const facturas = [
      mapFacturaRow(raw({ invoice_number: 'A', total: 300 }), new Map()),
      mapFacturaRow(raw({ invoice_number: 'B', total: 100 }), new Map()),
    ];
    const out = withParticipacion(facturas);
    expect(out[0].participacion).toBeCloseTo(0.75, 6);
    expect(out[1].participacion).toBeCloseTo(0.25, 6);
  });

  it('suma total 0 -> participación 0 sin dividir por cero', () => {
    const out = withParticipacion([mapFacturaRow(raw({ total: 0 }), new Map())]);
    expect(out[0].participacion).toBe(0);
  });
});

describe('buildResumen', () => {
  it('agrega facturación e IVA por mes y calcula acumulado', () => {
    const facturas = [
      mapFacturaRow(raw({ invoice_number: 'A', date: '2026-01-10', total: 1190, iva: '190' }), new Map()),
      mapFacturaRow(raw({ invoice_number: 'B', date: '2026-01-20', total: 2380, iva: '380' }), new Map()),
      mapFacturaRow(raw({ invoice_number: 'C', date: '2026-03-05', total: 1190, iva: '190' }), new Map()),
    ];
    const r = buildResumen(facturas);
    expect(r.meses[0].facturacion).toBeCloseTo(3570, 2); // enero: 1190+2380
    expect(r.meses[0].iva).toBeCloseTo(570, 2);
    expect(r.meses[1].facturacion).toBe(0);              // febrero
    expect(r.meses[0].acumulado).toBeCloseTo(3570, 2);
    expect(r.meses[2].acumulado).toBeCloseTo(4760, 2);   // marzo acumula enero+marzo
  });

  it('calcula el cumplimiento del presupuesto sobre el subtotal facturado del año', () => {
    const facturas = [mapFacturaRow(raw({ total: 1190, sub_total: 1000 }), new Map())];
    const r = buildResumen(facturas);
    expect(r.totalFacturadoSinIva).toBe(1000);
    expect(r.presupuesto2026).toBe(PRESUPUESTO_2026);
    expect(r.cumplimientoPct).toBeCloseTo(1000 / PRESUPUESTO_2026, 10);
  });
});
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test --workspace=apps/hub-api -- domain`
Expected: FAIL — `Cannot find module './domain.js'`.

- [ ] **Step 3: Implementar domain.ts**

Create `apps/hub-api/src/contabilidad/domain.ts`:

```ts
// Lógica de negocio de la app Contabilidad (sin BD). Reproduce la aritmética del
// Excel Contabilidad_muestra. Ver relaciones confirmadas contra una factura real:
//   TOTAL($) = sub_total (sin IVA); TOTAL+IVA = total; IVA = raw.tax_total.
//   porCobrar = balance; retenciones = raw.tax_amount_withheld.
//   cobrado% = 1 - balance/total; cobrado$ = total - balance - retenciones.

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v));

// Presupuesto y comparativos sembrados del Excel (COP, sin IVA).
export const PRESUPUESTO_2026 = 4_416_000_000;
export const FACTURACION_2025 = 4_079_226_260;
export const FACTURACION_2024 = 2_423_070_754;

/** Fila cruda tal como la devuelve el SQL (numéricos de raw llegan como texto). */
export interface FacturaRawRow {
  invoice_number: string;
  reference_number: string | null;
  customer_name: string | null;
  date: string;
  due_date: string | null;
  status: string | null;
  sub_total: number | null;   // columna sub_total (llega como número por el parser del pool)
  total: number | null;       // columna total (con IVA)
  iva: string | null;         // raw->>'tax_total' (texto)
  balance: string | null;     // raw->>'balance' (texto)
  retenciones: string | null; // raw->>'tax_amount_withheld' (texto)
  deal_name: string | null;   // crm.deals.deal_name (puede faltar)
  ticket_number: string | null; // desk.tickets.number (puede faltar)
  synced_at: string | null;
}

/** Factura ya calculada que consume el frontend. */
export interface FacturaContable {
  invoiceNumber: string;
  razonSocial: string;
  qt: string;
  fechaFactura: string;
  fechaVencimiento: string;
  ov: string;
  trato: string;
  ticket: string;
  total: number;        // sin IVA (Excel TOTAL$)
  iva: number;
  totalConIva: number;  // Excel TOTAL+IVA
  cobradoPct: number;   // 0..1
  cobrado: number;
  porCobrar: number;
  retenciones: number;
  participacion: number; // 0..1 (se asigna en withParticipacion)
  cartera: string;       // override manual
}

export function mapFacturaRow(row: FacturaRawRow, overrides: Map<string, string>): FacturaContable {
  const totalConIva = num(row.total);
  const porCobrar = num(row.balance);
  const retenciones = num(row.retenciones);
  const cobradoPct = totalConIva > 0 ? (totalConIva - porCobrar) / totalConIva : 0;
  const cobrado = totalConIva - porCobrar - retenciones;
  return {
    invoiceNumber: str(row.invoice_number),
    razonSocial: str(row.customer_name),
    qt: '', // La cotización de CRM no se replica a Postgres. Columna presente por paridad con el Excel; queda vacía.
    fechaFactura: str(row.date),
    fechaVencimiento: str(row.due_date),
    ov: str(row.reference_number),
    trato: str(row.deal_name),
    ticket: str(row.ticket_number),
    total: num(row.sub_total),
    iva: num(row.iva),
    totalConIva,
    cobradoPct,
    cobrado,
    porCobrar,
    retenciones,
    participacion: 0,
    cartera: overrides.get(str(row.invoice_number)) ?? '',
  };
}

/** De-dupe por invoice_number (facturas fantasma), quedándose con el synced_at más reciente. */
export function dedupeByInvoiceNumber(rows: FacturaRawRow[]): FacturaRawRow[] {
  const best = new Map<string, FacturaRawRow>();
  for (const r of rows) {
    const prev = best.get(r.invoice_number);
    if (!prev || str(r.synced_at) > str(prev.synced_at)) best.set(r.invoice_number, r);
  }
  return [...best.values()];
}

/** Asigna %participación = totalConIva de la factura / suma de totalConIva. */
export function withParticipacion(facturas: FacturaContable[]): FacturaContable[] {
  const suma = facturas.reduce((acc, f) => acc + f.totalConIva, 0);
  return facturas.map((f) => ({ ...f, participacion: suma > 0 ? f.totalConIva / suma : 0 }));
}

export interface ResumenMes {
  mes: number; // 1..12
  facturacion: number; // subtotal sin IVA del mes
  iva: number;
  acumulado: number; // subtotal acumulado del año hasta ese mes
}

export interface Resumen {
  meses: ResumenMes[];
  totalFacturadoSinIva: number;
  totalIva: number;
  presupuesto2026: number;
  facturacion2025: number;
  facturacion2024: number;
  cumplimientoPct: number; // totalFacturadoSinIva / presupuesto
}

/** Resumen mensual/anual. La facturación mensual usa el SUBTOTAL (sin IVA), como el Excel. */
export function buildResumen(facturas: FacturaContable[]): Resumen {
  const meses: ResumenMes[] = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    facturacion: 0,
    iva: 0,
    acumulado: 0,
  }));
  for (const f of facturas) {
    const m = Number(f.fechaFactura.slice(5, 7)); // 'YYYY-MM-...' -> MM
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
  return {
    meses,
    totalFacturadoSinIva,
    totalIva,
    presupuesto2026: PRESUPUESTO_2026,
    facturacion2025: FACTURACION_2025,
    facturacion2024: FACTURACION_2024,
    cumplimientoPct: PRESUPUESTO_2026 > 0 ? totalFacturadoSinIva / PRESUPUESTO_2026 : 0,
  };
}
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `npm run test --workspace=apps/hub-api -- domain`
Expected: PASS (todos los `describe`).

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/contabilidad/domain.ts apps/hub-api/src/contabilidad/domain.test.ts
git commit -m "feat(contabilidad): logica de dominio (mapeo, dedupe, participacion, resumen)"
```

---

### Task 3: Capa de datos (SQL de facturas + repo de overrides)

Capa fina sobre la BD. No lleva test unitario (necesita la réplica real; se verifica en Task 10). Sigue el estilo de `reconciliation.ts` (SQL) y respeta la regla de leer numéricos de `raw` como texto.

**Files:**
- Create: `apps/hub-api/src/contabilidad/source.ts`

- [ ] **Step 1: Implementar source.ts**

Create `apps/hub-api/src/contabilidad/source.ts`:

```ts
import type { Pool } from '@algarpibe/zoho-sync';
import {
  mapFacturaRow,
  dedupeByInvoiceNumber,
  withParticipacion,
  buildResumen,
  type FacturaRawRow,
  type FacturaContable,
  type Resumen,
} from './domain.js';

export interface ContabilidadData {
  facturas: FacturaContable[];
  resumen: Resumen;
}

// Rango del año contable. La app es "Facturación 2026".
const ANIO = 2026;
const DESDE = `${ANIO}-01-01`;
const HASTA = `${ANIO + 1}-01-01`;

// Numéricos de raw como TEXTO (regla de la casa: un ::numeric con "12.5%" aborta
// la consulta). sub_total/total son columnas numéricas reales -> llegan casteadas.
// Trato y Ticket por LEFT JOIN; suelen venir NULL (link vacío en Zoho) -> columna vacía.
const FACTURAS_SQL = `
  SELECT i.invoice_number,
         i.reference_number,
         i.customer_name,
         i.date::text                                  AS date,
         i.due_date::text                              AS due_date,
         i.status,
         i.sub_total,
         i.total,
         NULLIF(i.raw ->> 'tax_total', '')             AS iva,
         NULLIF(i.raw ->> 'balance', '')               AS balance,
         NULLIF(i.raw ->> 'tax_amount_withheld', '')   AS retenciones,
         d.deal_name                                   AS deal_name,
         tk.number                                     AS ticket_number,
         i.synced_at::text                             AS synced_at
    FROM books.invoices i
    LEFT JOIN crm.deals d
           ON d.id = NULLIF(i.raw ->> 'zcrm_potential_id', '')
    LEFT JOIN LATERAL (
           SELECT t.number
             FROM desk.tickets t
            WHERE t.orden_venta = i.reference_number
            ORDER BY t.number
            LIMIT 1
         ) tk ON TRUE
   WHERE i.date >= $1::date AND i.date < $2::date
   ORDER BY i.date, i.invoice_number`;

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

/** Facturas 2026 + resumen, con la cartera fusionada. */
export async function getContabilidadData(db: Pool): Promise<ContabilidadData> {
  const [{ rows }, overrides] = await Promise.all([
    db.query(FACTURAS_SQL, [DESDE, HASTA]),
    getCarteraOverrides(db),
  ]);
  const dedup = dedupeByInvoiceNumber(rows as FacturaRawRow[]);
  const facturas = withParticipacion(dedup.map((r) => mapFacturaRow(r, overrides)));
  const resumen = buildResumen(facturas);
  return { facturas, resumen };
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build --workspace=apps/hub-api`
Expected: sin errores de TypeScript.

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/contabilidad/source.ts
git commit -m "feat(contabilidad): capa de datos (SQL facturas + repo overrides cartera)"
```

---

### Task 4: Router + montaje en index.ts

**Files:**
- Create: `apps/hub-api/src/contabilidad/router.ts`
- Test: `apps/hub-api/src/contabilidad/router.test.ts`
- Modify: `apps/hub-api/src/index.ts` (import + mount)

- [ ] **Step 1: Escribir el test de integración que falla**

Create `apps/hub-api/src/contabilidad/router.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';

// IMPORTANTE: auth.ts captura JWT_SECRET en una const AL CARGAR EL MÓDULO. Por eso
// (1) fijamos el env ANTES de cualquier import de auth, y (2) importamos el router
// de forma DINÁMICA en beforeAll (import estático evaluaría auth.ts con el secret
// vacío). Mismo patrón que auth.middleware.test.ts.
const SECRET = 'test-secret-contabilidad';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

let createContabilidadRouter: typeof import('./router.js')['createContabilidadRouter'];
beforeAll(async () => {
  ({ createContabilidadRouter } = await import('./router.js'));
});

// requireAuth de auth.ts consulta la BD para usuarios con user_id. Usamos un
// token legacy (sin user_id) para que pase por la rama que no toca BD.
function token(apps: string[], role = 'reader'): string {
  return jwt.sign({ sub: 'u@t.co', role, apps }, SECRET); // sin user_id -> rama legacy
}

function appConPool(pool: Partial<Pool>): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createContabilidadRouter(pool as Pool));
  return app;
}

const fakePool = (): Partial<Pool> => ({
  // getContabilidadData hace 2 queries: facturas y overrides. Devolvemos vacío.
  query: vi.fn().mockResolvedValue({ rows: [] }),
});

describe('GET /api/contabilidad/facturas', () => {
  it('401 sin token', async () => {
    const res = await request(appConPool(fakePool())).get('/api/contabilidad/facturas');
    expect(res.status).toBe(401);
  });

  it('403 si el JWT no tiene la app contabilidad', async () => {
    const res = await request(appConPool(fakePool()))
      .get('/api/contabilidad/facturas')
      .set('Authorization', `Bearer ${token(['otra-app'])}`);
    expect(res.status).toBe(403);
  });

  it('200 y devuelve { facturas, resumen } con la app asignada', async () => {
    const res = await request(appConPool(fakePool()))
      .get('/api/contabilidad/facturas')
      .set('Authorization', `Bearer ${token(['contabilidad'])}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.facturas)).toBe(true);
    expect(res.body.resumen.meses).toHaveLength(12);
    expect(res.body.resumen.presupuesto2026).toBe(4416000000);
  });
});

describe('PUT /api/contabilidad/cartera/:invoiceNumber', () => {
  it('403 sin la app asignada', async () => {
    const res = await request(appConPool(fakePool()))
      .put('/api/contabilidad/cartera/AM0001')
      .set('Authorization', `Bearer ${token(['otra-app'])}`)
      .send({ cartera: 'En gestión' });
    expect(res.status).toBe(403);
  });

  it('200 y hace upsert de la cartera', async () => {
    const pool = fakePool();
    const res = await request(appConPool(pool))
      .put('/api/contabilidad/cartera/AM0001')
      .set('Authorization', `Bearer ${token(['contabilidad'])}`)
      .send({ cartera: 'En gestión' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(pool.query).toHaveBeenCalled();
  });

  it('400 si falta el campo cartera', async () => {
    const res = await request(appConPool(fakePool()))
      .put('/api/contabilidad/cartera/AM0001')
      .set('Authorization', `Bearer ${token(['contabilidad'])}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test --workspace=apps/hub-api -- contabilidad/router`
Expected: FAIL — `Cannot find module './router.js'`.

- [ ] **Step 3: Implementar router.ts**

Create `apps/hub-api/src/contabilidad/router.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached, clearCache } from '../cache.js';
import { getContabilidadData, upsertCartera } from './source.js';

const APP_ID = 'contabilidad';

function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

export function createContabilidadRouter(db: Pool): Router {
  const router = Router();

  router.get('/contabilidad/facturas', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try {
      const data = await cached('contabilidad:facturas', () => getContabilidadData(db));
      res.json(data);
    } catch (e) {
      sendError(res, e, 'contabilidad_facturas');
    }
  });

  router.put('/contabilidad/cartera/:invoiceNumber', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const cartera = (req.body as { cartera?: unknown }).cartera;
      if (typeof cartera !== 'string') {
        return void res.status(400).json({ error: 'cartera (string) requerido' });
      }
      const userId = getPayload(req)?.user_id ?? null;
      await upsertCartera(db, req.params.invoiceNumber, cartera, userId ? String(userId) : null);
      clearCache(); // invalida el cache de facturas para que el próximo GET traiga la cartera nueva
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, 'contabilidad_cartera');
    }
  });

  return router;
}
```

- [ ] **Step 4: Verificar que `clearCache` existe en cache.js**

Run: `grep -n "export function clearCache" apps/hub-api/src/cache.ts`
Expected: una línea. (El reporte de arquitectura confirma que existe. Si NO existiera, sustituir `clearCache()` por nada y bajar el TTL — pero se espera que exista.)

- [ ] **Step 5: Ejecutar el test para verlo pasar**

Run: `npm run test --workspace=apps/hub-api -- contabilidad/router`
Expected: PASS.

- [ ] **Step 6: Montar el router en index.ts**

En `apps/hub-api/src/index.ts`:

a) Añadir el import junto a los otros router imports (cerca de `import { createWoSalesRouter } from './wo-sales/router.js';`):

```ts
import { createContabilidadRouter } from './contabilidad/router.js';
```

b) Dentro del bloque `initDb().then(() => { ... })`, justo después de la línea `app.use('/api', createWoSalesRouter(getHubPool()));`, añadir:

```ts
app.use('/api', createContabilidadRouter(getHubPool()));
```

- [ ] **Step 7: Verificar build + toda la suite de hub-api**

Run: `npm run build --workspace=apps/hub-api && npm run test --workspace=apps/hub-api`
Expected: build sin errores; todos los tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/hub-api/src/contabilidad/router.ts apps/hub-api/src/contabilidad/router.test.ts apps/hub-api/src/index.ts
git commit -m "feat(contabilidad): endpoints /api/contabilidad/facturas y PUT cartera"
```

---

## Parte B — Frontend (apps/contabilidad)

### Task 5: Scaffold de la app

**Files:**
- Create: `apps/contabilidad/package.json`
- Create: `apps/contabilidad/vite.config.ts`
- Create: `apps/contabilidad/tsconfig.json`
- Create: `apps/contabilidad/index.html`
- Create: `apps/contabilidad/src/main.tsx`
- Create: `apps/contabilidad/src/App.tsx` (placeholder)

- [ ] **Step 1: package.json**

Create `apps/contabilidad/package.json`:

```json
{
  "name": "contabilidad",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^0.562.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.1.1",
    "typescript": "~5.9.3",
    "vite": "^7.2.4"
  }
}
```

- [ ] **Step 2: vite.config.ts** (alias de react a la raíz — imprescindible: el portal importa este App.tsx en la misma build)

Create `apps/contabilidad/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  server: {
    port: 5183,
  },
})
```

- [ ] **Step 3: tsconfig.json** (copia exacta del de WO-sales)

Create `apps/contabilidad/tsconfig.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "types": ["vite/client"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: index.html**

Create `apps/contabilidad/index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Contabilidad</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: src/main.tsx**

Create `apps/contabilidad/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// Solo para `npm run dev` en local. En producción el portal importa App.tsx
// directamente y aporta el CSS (Tailwind) desde su propia build.
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
```

- [ ] **Step 6: src/App.tsx** (placeholder, se completa en Task 6-8)

Create `apps/contabilidad/src/App.tsx`:

```tsx
export default function App() {
  return <main className="flex-grow bg-transparent p-6 overflow-y-auto">Contabilidad</main>;
}
```

- [ ] **Step 7: Instalar y verificar que la app suelta compila**

Run: `npm install && npm run build --workspace=apps/contabilidad`
Expected: build de Vite OK, genera `apps/contabilidad/dist`.

- [ ] **Step 8: Commit**

```bash
git add apps/contabilidad/package.json apps/contabilidad/vite.config.ts apps/contabilidad/tsconfig.json apps/contabilidad/index.html apps/contabilidad/src/main.tsx apps/contabilidad/src/App.tsx package-lock.json
git commit -m "feat(contabilidad): scaffold de la app frontend"
```

---

### Task 6: Capa de API y formato del frontend

**Files:**
- Create: `apps/contabilidad/src/format.ts`
- Create: `apps/contabilidad/src/api.ts`

- [ ] **Step 1: format.ts** (COP y porcentaje, convención `es-CO`)

Create `apps/contabilidad/src/format.ts`:

```ts
const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Formatea un valor en pesos colombianos sin decimales. */
export function formatCOP(n: number): string {
  return cop.format(Number.isFinite(n) ? n : 0);
}

/** Formatea una fracción 0..1 como porcentaje con un decimal. */
export function formatPct(fraccion: number): string {
  const v = Number.isFinite(fraccion) ? fraccion * 100 : 0;
  return `${v.toFixed(1)}%`;
}
```

- [ ] **Step 2: api.ts** (tipos espejo del backend + fetch + errores)

Create `apps/contabilidad/src/api.ts`:

```ts
const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Espejo de apps/hub-api/src/contabilidad/domain.ts
export interface FacturaContable {
  invoiceNumber: string;
  razonSocial: string;
  qt: string;
  fechaFactura: string;
  fechaVencimiento: string;
  ov: string;
  trato: string;
  ticket: string;
  total: number;
  iva: number;
  totalConIva: number;
  cobradoPct: number;
  cobrado: number;
  porCobrar: number;
  retenciones: number;
  participacion: number;
  cartera: string;
}

export interface ResumenMes {
  mes: number;
  facturacion: number;
  iva: number;
  acumulado: number;
}

export interface Resumen {
  meses: ResumenMes[];
  totalFacturadoSinIva: number;
  totalIva: number;
  presupuesto2026: number;
  facturacion2025: number;
  facturacion2024: number;
  cumplimientoPct: number;
}

export interface ContabilidadData {
  facturas: FacturaContable[];
  resumen: Resumen;
}

async function mensajeDeError(res: Response): Promise<string> {
  if (res.status === 401) return 'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.';
  if (res.status === 403) return 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.';
  return `No se pudieron cargar los datos (error ${res.status}). Inténtalo de nuevo en un momento.`;
}

/** Carga las facturas 2026 + resumen. Lanza Error con mensaje en español si falla. */
export async function fetchContabilidad(): Promise<ContabilidadData> {
  const res = await fetch(`${API_BASE}/api/contabilidad/facturas`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as ContabilidadData;
}

/** Guarda la cartera de una factura. Lanza Error con mensaje en español si falla. */
export async function guardarCartera(invoiceNumber: string, cartera: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/contabilidad/cartera/${encodeURIComponent(invoiceNumber)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ cartera }),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run build --workspace=apps/contabilidad`
Expected: build OK (aún no se usan; TypeScript no marca imports sin usar en archivos de librería).

- [ ] **Step 4: Commit**

```bash
git add apps/contabilidad/src/format.ts apps/contabilidad/src/api.ts
git commit -m "feat(contabilidad): capa de API (fetch facturas/cartera) y formato COP"
```

---

### Task 7: Tabla de facturación (con orden y estados de carga)

**Files:**
- Create: `apps/contabilidad/src/FacturasTable.tsx`

- [ ] **Step 1: Implementar FacturasTable.tsx** (tabla densa, ordenable, con celda Cartera editable)

Create `apps/contabilidad/src/FacturasTable.tsx`:

```tsx
import { useMemo, useState } from 'react';
import type { FacturaContable } from './api';
import { formatCOP, formatPct } from './format';

type SortKey = keyof FacturaContable;
interface Props {
  facturas: FacturaContable[];
  onEditarCartera: (invoiceNumber: string, cartera: string) => void;
  guardando: string | null; // invoiceNumber que se está guardando, o null
}

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right'; kind: 'text' | 'money' | 'pct' }[] = [
  { key: 'razonSocial', label: 'RAZÓN SOCIAL', align: 'left', kind: 'text' },
  { key: 'qt', label: 'QT', align: 'left', kind: 'text' },
  { key: 'fechaFactura', label: 'FECHA FACTURA', align: 'left', kind: 'text' },
  { key: 'fechaVencimiento', label: 'FECHA VENC.', align: 'left', kind: 'text' },
  { key: 'ov', label: 'OV', align: 'left', kind: 'text' },
  { key: 'trato', label: 'TRATO', align: 'left', kind: 'text' },
  { key: 'ticket', label: 'TICKET', align: 'left', kind: 'text' },
  { key: 'total', label: 'TOTAL ($)', align: 'right', kind: 'money' },
  { key: 'iva', label: 'IVA (19%)', align: 'right', kind: 'money' },
  { key: 'totalConIva', label: 'TOTAL + IVA', align: 'right', kind: 'money' },
  { key: 'cobradoPct', label: 'COBRADO (%)', align: 'right', kind: 'pct' },
  { key: 'cobrado', label: 'COBRADO ($)', align: 'right', kind: 'money' },
  { key: 'porCobrar', label: 'POR COBRAR ($)', align: 'right', kind: 'money' },
  { key: 'retenciones', label: 'RETENCIONES', align: 'right', kind: 'money' },
  { key: 'participacion', label: '% PART.', align: 'right', kind: 'pct' },
  { key: 'invoiceNumber', label: 'FACTURA', align: 'left', kind: 'text' },
];

function cell(f: FacturaContable, kind: 'text' | 'money' | 'pct', key: SortKey): string {
  const v = f[key];
  if (kind === 'money') return formatCOP(v as number);
  if (kind === 'pct') return formatPct(v as number);
  return String(v ?? '');
}

export default function FacturasTable({ facturas, onEditarCartera, guardando }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fechaFactura', dir: 1 });

  const ordenadas = useMemo(() => {
    const arr = [...facturas];
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv), 'es') * sort.dir;
    });
    return arr;
  }, [facturas, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-2 py-2 text-left font-semibold">#</th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                onClick={() => toggleSort(c.key)}
                className={`cursor-pointer select-none px-2 py-2 font-semibold whitespace-nowrap ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                } hover:text-gray-900`}
              >
                {c.label}
                {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
            <th className="px-2 py-2 text-left font-semibold">CARTERA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ordenadas.map((f, i) => (
            <tr key={f.invoiceNumber} className="hover:bg-blue-50/40">
              <td className="px-2 py-1 text-gray-400">{i + 1}</td>
              {COLUMNS.map((c) => (
                <td
                  key={c.key}
                  className={`px-2 py-1 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                >
                  {cell(f, c.kind, c.key)}
                </td>
              ))}
              <td className="px-2 py-1">
                <input
                  type="text"
                  defaultValue={f.cartera}
                  disabled={guardando === f.invoiceNumber}
                  onBlur={(e) => {
                    if (e.target.value !== f.cartera) onEditarCartera(f.invoiceNumber, e.target.value);
                  }}
                  placeholder="—"
                  className="w-36 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-300 focus:border-blue-400 focus:bg-white focus:outline-none"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build --workspace=apps/contabilidad`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add apps/contabilidad/src/FacturasTable.tsx
git commit -m "feat(contabilidad): tabla de facturacion ordenable con cartera editable"
```

---

### Task 8: Bloque de resumen mensual vs presupuesto

**Files:**
- Create: `apps/contabilidad/src/ResumenMensual.tsx`

- [ ] **Step 1: Implementar ResumenMensual.tsx**

Create `apps/contabilidad/src/ResumenMensual.tsx`:

```tsx
import type { Resumen } from './api';
import { formatCOP, formatPct } from './format';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export default function ResumenMensual({ resumen }: { resumen: Resumen }) {
  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Resumen 2026</h2>

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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Facturado 2026 (sin IVA)" value={formatCOP(resumen.totalFacturadoSinIva)} />
        <Kpi label="Presupuesto 2026" value={formatCOP(resumen.presupuesto2026)} />
        <Kpi label="Cumplimiento" value={formatPct(resumen.cumplimientoPct)} />
        <Kpi label="IVA total 2026" value={formatCOP(resumen.totalIva)} />
        <Kpi label="Facturación 2025" value={formatCOP(resumen.facturacion2025)} />
        <Kpi label="Facturación 2024" value={formatCOP(resumen.facturacion2024)} />
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
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build --workspace=apps/contabilidad`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add apps/contabilidad/src/ResumenMensual.tsx
git commit -m "feat(contabilidad): bloque de resumen mensual vs presupuesto"
```

---

### Task 9: App.tsx — composición, carga de datos y edición de cartera

**Files:**
- Modify: `apps/contabilidad/src/App.tsx` (reemplaza el placeholder)

- [ ] **Step 1: Reemplazar App.tsx completo**

Replace the entire contents of `apps/contabilidad/src/App.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, Search, Landmark } from 'lucide-react';
import { fetchContabilidad, guardarCartera, type ContabilidadData } from './api';
import FacturasTable from './FacturasTable';
import ResumenMensual from './ResumenMensual';

export default function App() {
  const [data, setData] = useState<ContabilidadData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetchContabilidad()
      .then((d) => vivo && (setData(d), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const facturasFiltradas = useMemo(() => {
    if (!data) return [];
    const q = filtro.trim().toLowerCase();
    if (!q) return data.facturas;
    return data.facturas.filter(
      (f) =>
        f.razonSocial.toLowerCase().includes(q) ||
        f.ov.toLowerCase().includes(q) ||
        f.invoiceNumber.toLowerCase().includes(q),
    );
  }, [data, filtro]);

  async function onEditarCartera(invoiceNumber: string, cartera: string) {
    if (!data) return;
    // Optimista: actualiza en memoria y persiste. Si falla, revierte y avisa.
    const anterior = data.facturas.find((f) => f.invoiceNumber === invoiceNumber)?.cartera ?? '';
    setData({
      ...data,
      facturas: data.facturas.map((f) => (f.invoiceNumber === invoiceNumber ? { ...f, cartera } : f)),
    });
    setGuardando(invoiceNumber);
    try {
      await guardarCartera(invoiceNumber, cartera);
    } catch (e) {
      setData((d) =>
        d
          ? { ...d, facturas: d.facturas.map((f) => (f.invoiceNumber === invoiceNumber ? { ...f, cartera: anterior } : f)) }
          : d,
      );
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  }

  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      <header className="mb-6 flex items-center gap-3">
        <Landmark className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Contabilidad — Facturación 2026</h1>
          <p className="text-sm text-gray-500">Datos en vivo desde Zoho. La columna Cartera se guarda al salir de la celda.</p>
        </div>
      </header>

      {cargando && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando facturas…
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {data && !cargando && (
        <>
          <div className="mb-4 flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Buscar por cliente, OV o factura…"
                className="w-72 rounded-xl border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <span className="text-sm text-gray-500">{facturasFiltradas.length} facturas</span>
          </div>

          <FacturasTable facturas={facturasFiltradas} onEditarCartera={onEditarCartera} guardando={guardando} />
          <ResumenMensual resumen={data.resumen} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build --workspace=apps/contabilidad`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add apps/contabilidad/src/App.tsx
git commit -m "feat(contabilidad): App.tsx compone tabla + resumen + edicion de cartera"
```

---

## Parte C — Integración al portal

### Task 10: Registrar la app en el portal

**Files:**
- Modify: `apps/portal/src/lib/apps.ts` (array `APPS`)
- Modify: `apps/portal/src/App.tsx` (import lazy + ruta)
- Modify: `Dockerfile` (COPY del package.json)

- [ ] **Step 1: Añadir la entrada en el catálogo `APPS`**

En `apps/portal/src/lib/apps.ts`, añadir al final del array `APPS` (después de la entrada `WO-sales`):

```ts
  { id: 'contabilidad', label: 'Contabilidad', route: '/contabilidad', category: 'aplicacion' },
```

- [ ] **Step 2: Import lazy en el App.tsx del portal**

En `apps/portal/src/App.tsx`, junto a los otros `lazyConReintento` (después de la línea de `CargaPedidosWO`):

```tsx
const Contabilidad = lazyConReintento(() => import('../../contabilidad/src/App'));
```

- [ ] **Step 3: Ruta protegida**

En `apps/portal/src/App.tsx`, junto a las otras `<Route>` de apps (después de la de `carga-pedidos-wo`):

```tsx
<Route path="/contabilidad/*" element={<AppGuard appId="contabilidad"><Contabilidad /></AppGuard>} />
```

- [ ] **Step 4: COPY en el Dockerfile** (consistencia con las demás apps; el build cachea mejor)

En `Dockerfile`, en el bloque de COPYs de package.json (tras `COPY apps/product-sales/package*.json ./apps/product-sales/`):

```dockerfile
COPY apps/contabilidad/package*.json ./apps/contabilidad/
```

- [ ] **Step 5: Verificar que el portal compila con la app embebida**

Run: `npm run build --workspace=apps/portal`
Expected: `tsc -b && vite build` sin errores; la ruta lazy resuelve `../../contabilidad/src/App`.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/lib/apps.ts apps/portal/src/App.tsx Dockerfile
git commit -m "feat(portal): registrar la app Contabilidad (ruta /contabilidad)"
```

---

## Parte D — Verificación contra datos reales y rollout

### Task 11: Confirmar el contrato de datos contra la réplica real

Los `raw` keys se confirmaron contra la API de Zoho, pero **no** contra la columna `raw` de la réplica (el MCP apuntaba a otra BD). Este paso lo cierra antes de dar por buena la app.

- [ ] **Step 1: Ejecutar la sonda SQL contra el `HUB_DB_URL` real**

Con acceso a la BD `zoho-hub` (EasyPanel, usuario `conciliador_reader`), ejecutar:

```sql
SELECT invoice_number,
       sub_total,
       total,
       raw->>'tax_total'            AS iva,
       raw->>'tax_amount_withheld'  AS retenciones,
       raw->>'balance'              AS balance,
       raw->>'zcrm_potential_id'    AS deal_id,
       (SELECT count(*) FROM books.invoices x WHERE x.invoice_number = i.invoice_number) AS copias
  FROM books.invoices i
 WHERE date >= '2026-01-01' AND date < '2027-01-01'
 ORDER BY date
 LIMIT 30;
```

Confirmar: `iva`, `retenciones`, `balance` vienen poblados y numéricos; medir cuántas filas traen `deal_id` no vacío (esperado: pocas); ver si `copias > 1` en alguna (facturas fantasma → el dedupe de Task 2 las cubre).

- [ ] **Step 2: Verificar la existencia de los esquemas/columnas del join**

```sql
SELECT to_regclass('crm.deals')      AS crm_deals,
       to_regclass('desk.tickets')   AS desk_tickets;
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'desk' AND table_name = 'tickets' AND column_name = 'orden_venta';
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'crm' AND table_name = 'deals' AND column_name IN ('id', 'deal_name');
```

Si alguna tabla/columna del join NO existe (`NULL`/vacío), ajustar `FACTURAS_SQL` en `source.ts`: quitar ese LEFT JOIN y mapear el campo a `''`. Recompilar y volver a Task 4 Step 7.

- [ ] **Step 3: (Opcional) Contrastar el total facturado con el Excel**

Sumar `sub_total` de 2026 en la sonda y comparar con `TOTAL 2026` del Excel (`2.026.259.304`) para los meses ya facturados. Diferencias grandes → revisar dedupe o estados de factura incluidos (¿facturas anuladas/void?). Si hay que excluir estados, añadir `AND i.status <> 'void'` al `FACTURAS_SQL`.

### Task 12: Desplegar y asignar la app

- [ ] **Step 1: Desplegar hub-api** (contiene la migración 007 + los endpoints nuevos). Al arrancar, en logs debe aparecer `migration applied: 007_contabilidad_overrides.sql`.

- [ ] **Step 2: Desplegar el portal** (la nueva ruta/app embebida).

- [ ] **Step 3: Asignar la app al usuario** desde el panel admin del portal (Admin → Usuarios → asignar `Contabilidad`). Esto escribe `portal.user_apps` y entra en el JWT (`apps[]`). Cerrar sesión y volver a entrar para refrescar el token.

- [ ] **Step 4: E2E manual en el portal**
  - La app **Contabilidad** aparece en el sidebar; abrir `/contabilidad`.
  - Carga la tabla de facturas 2026 desde Zoho (sin subir Excel).
  - Ordenar por una columna (clic en encabezado) funciona; el filtro por cliente/OV/factura funciona.
  - Escribir un valor en **Cartera** de una factura, salir de la celda, recargar la página → el valor persiste.
  - El resumen mensual y el % de cumplimiento vs Pto 2026 son coherentes con el Excel para los meses ya facturados.
  - Un usuario **sin** la app asignada recibe 403 (verificable en la pestaña de red) y el `AppGuard` lo redirige.

---

## Notas de decisiones (para el implementador)

- **QT** queda en blanco: la cotización del CRM no se replica a Postgres. Columna presente por paridad con el Excel. Si en el futuro se quiere poblar, requiere la API viva de Zoho CRM, no la réplica.
- **Trato/Ticket** salen por LEFT JOIN y **a menudo estarán vacíos** (el link nativo de Zoho viene sin poblar en muchas facturas). Es esperado, no un bug.
- **Presupuesto** sembrado como constantes en `domain.ts`. Editarlo hoy = cambiar la constante y redeploy. Una UI de edición queda fuera de alcance (decisión del usuario).
- **Cache**: el GET usa `cached('contabilidad:facturas', …)` (~2 min); el PUT hace `clearCache()` para que el cambio de cartera se vea en el próximo GET.
- **Dedupe**: obligatorio por el incidente de facturas fantasma (`docs/incidents/2026-07-17-facturas-fantasma-zoho-hub.md`).
```
