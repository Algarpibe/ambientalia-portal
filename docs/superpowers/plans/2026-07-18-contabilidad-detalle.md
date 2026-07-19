# Contabilidad: modal de detalle de Factura / OV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Pasos con checkbox `- [ ]`.

**Goal:** Clic en una fila de la tabla de facturas → modal con el detalle de la factura; clic en una fila de OV pendientes → modal con el detalle de la OV. Estilo limpio del portal. Backend: 2 endpoints propios de contabilidad. Frontend: un `DetalleModal` reutilizable.

**Rama:** `feat/contabilidad-detalle`. **Spec:** `docs/superpowers/specs/2026-07-18-contabilidad-detalle-design.md`.

**Datos (verificado en el código existente):**
- Factura: `books.invoices` (invoice_id, customer_id, date, due_date, sub_total, total, reference_number; raw: tax_total, balance, payment_terms_label, billing_address). Líneas: `books.invoice_line_items` (por `invoice_id`) → `books.items` (por `item_id`): `it.sku`, `it.name`, `li.quantity`, `li.rate`.
- OV: `books.sales_orders` (salesorder_id, customer_id, date, sub_total, total; raw: shipment_date, payment_terms_label, tax_total). Líneas: `books.salesorder_line_items` (por `salesorder_id`) → `books.items`.
- NIT: `books.contacts` join `customer_id = contact_id` → `c.nit`.

**Estado del código:**
- `apps/hub-api/src/contabilidad/router.ts`: `createContabilidadRouter(db)`, helpers `cached`, `requireAuth`, `requireApp(APP_ID)` (`APP_ID='contabilidad'`), `sendError`, `Request`/`Response` de express ya importados.
- `apps/contabilidad/src/FacturasTable.tsx`: fila `<tr key={f.invoiceNumber}>`, última celda = input de Cartera (editable). Props `{ facturas, onEditarCartera, guardando }`.
- `apps/contabilidad/src/OVPendientes.tsx`: sección autocontenida; filas `<tr key={o.salesorder_number}>`.
- `apps/contabilidad/src/App.tsx`: renderiza `<FacturasTable .../>`, `<ResumenMensual/>`, `<OVPendientes/>`.

---

## Parte A — Backend

### Task 1: Módulo detalle.ts (SQL + buildLineas puro + getters) con TDD

**Files:**
- Create: `apps/hub-api/src/contabilidad/detalle.ts`
- Create: `apps/hub-api/src/contabilidad/detalle.test.ts`

- [ ] **Step 1: Test primero** — `apps/hub-api/src/contabilidad/detalle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildLineas, type LineaRow } from './detalle.js';

describe('buildLineas', () => {
  it('mapea y calcula total = cantidad * precio', () => {
    const rows: LineaRow[] = [
      { sku: 'CIL-1', nombre: 'Cilindro', cantidad: 3, precio: 100 },
      { sku: null, nombre: null, cantidad: null, precio: null },
    ];
    const r = buildLineas(rows);
    expect(r[0]).toEqual({ sku: 'CIL-1', nombre: 'Cilindro', cantidad: 3, precio: 100, total: 300 });
    expect(r[1]).toEqual({ sku: '', nombre: '', cantidad: 0, precio: 0, total: 0 });
  });

  it('valores no numéricos → 0 (no rompe)', () => {
    const r = buildLineas([{ sku: 'X', nombre: 'Y', cantidad: 'n/a' as unknown as number, precio: '' as unknown as number }]);
    expect(r[0].total).toBe(0);
  });
});
```

- [ ] **Step 2: Ver fallar** — Run: `npm run test --workspace=apps/hub-api -- detalle`. Expected: FAIL (no existe).

- [ ] **Step 3: Crear detalle.ts** — `apps/hub-api/src/contabilidad/detalle.ts`:

```ts
import type { Pool } from '@algarpibe/zoho-sync';

// Detalle de una factura / OV para el modal de la app Contabilidad: cabecera +
// líneas (SKU/nombre/uds/precio) + totales. Los totales salen de la cabecera del
// documento (sub_total/total/tax_total), NO de sumar líneas, para cuadrar con Zoho.

export interface DetalleLinea {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number; // COP
  total: number;  // cantidad * precio
}

export interface DetalleFactura {
  numero: string;
  cliente: string;
  nit: string | null;
  direccion: string | null;
  fecha: string;
  vencimiento: string | null;
  terminos: string | null;
  ov: string | null;
  saldo: number;
  lineas: DetalleLinea[];
  subtotal: number;
  iva: number;
  total: number;
}

export interface DetalleOV {
  numero: string;
  cliente: string;
  nit: string | null;
  direccion: string | null;
  fecha: string;
  entrega: string | null;
  terminos: string | null;
  lineas: DetalleLinea[];
  subtotal: number;
  iva: number;
  total: number;
}

export interface LineaRow {
  sku: string | null;
  nombre: string | null;
  cantidad: number | null;
  precio: number | null;
}

function n(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Mapea filas de línea a DetalleLinea, calculando el total por línea. Puro. */
export function buildLineas(rows: LineaRow[]): DetalleLinea[] {
  return rows.map((r) => {
    const cantidad = n(r.cantidad);
    const precio = n(r.precio);
    return { sku: r.sku ?? '', nombre: r.nombre ?? '', cantidad, precio, total: cantidad * precio };
  });
}

const DIRECCION = (col: string) =>
  `NULLIF(concat_ws(', ', NULLIF(${col} -> 'billing_address' ->> 'address', ''), NULLIF(${col} -> 'billing_address' ->> 'city', '')), '')`;

const FACTURA_HEADER_SQL = `
  SELECT i.invoice_number, i.customer_name, i.date::text AS fecha, i.due_date::text AS vencimiento,
         i.sub_total, i.total,
         NULLIF(i.raw ->> 'tax_total', '')            AS iva,
         NULLIF(i.raw ->> 'balance', '')              AS saldo,
         NULLIF(i.raw ->> 'payment_terms_label', '')  AS terminos,
         i.reference_number                           AS ov,
         c.nit,
         ${DIRECCION('i.raw')}                        AS direccion
    FROM books.invoices i
    LEFT JOIN books.contacts c ON c.contact_id = i.customer_id
   WHERE i.invoice_number = $1
   LIMIT 1`;

const FACTURA_LINEAS_SQL = `
  SELECT it.sku, it.name AS nombre, li.quantity AS cantidad, li.rate AS precio
    FROM books.invoice_line_items li
    JOIN books.invoices i ON i.invoice_id = li.invoice_id
    LEFT JOIN books.items it ON it.item_id = li.item_id
   WHERE i.invoice_number = $1
   ORDER BY li.line_item_id`;

const OV_HEADER_SQL = `
  SELECT so.salesorder_number, so.customer_name, so.date::text AS fecha,
         NULLIF(so.raw ->> 'shipment_date', '')       AS entrega,
         so.sub_total, so.total,
         NULLIF(so.raw ->> 'tax_total', '')           AS iva,
         NULLIF(so.raw ->> 'payment_terms_label', '') AS terminos,
         c.nit,
         ${DIRECCION('so.raw')}                       AS direccion
    FROM books.sales_orders so
    LEFT JOIN books.contacts c ON c.contact_id = so.customer_id
   WHERE so.salesorder_number = $1
   LIMIT 1`;

const OV_LINEAS_SQL = `
  SELECT it.sku, it.name AS nombre, li.quantity AS cantidad, li.rate AS precio
    FROM books.salesorder_line_items li
    JOIN books.sales_orders so ON so.salesorder_id = li.salesorder_id
    LEFT JOIN books.items it ON it.item_id = li.item_id
   WHERE so.salesorder_number = $1
   ORDER BY li.line_item_id`;

export async function getDetalleFactura(db: Pool, numero: string): Promise<DetalleFactura | null> {
  const { rows: h } = await db.query(FACTURA_HEADER_SQL, [numero]);
  if (!h.length) return null;
  const head = h[0] as Record<string, unknown>;
  const { rows: l } = await db.query(FACTURA_LINEAS_SQL, [numero]);
  return {
    numero: String(head.invoice_number),
    cliente: (head.customer_name as string) ?? '',
    nit: (head.nit as string) ?? null,
    direccion: (head.direccion as string) ?? null,
    fecha: head.fecha as string,
    vencimiento: (head.vencimiento as string) ?? null,
    terminos: (head.terminos as string) ?? null,
    ov: (head.ov as string) ?? null,
    saldo: n(head.saldo),
    lineas: buildLineas(l as LineaRow[]),
    subtotal: n(head.sub_total),
    iva: n(head.iva),
    total: n(head.total),
  };
}

export async function getDetalleOV(db: Pool, numero: string): Promise<DetalleOV | null> {
  const { rows: h } = await db.query(OV_HEADER_SQL, [numero]);
  if (!h.length) return null;
  const head = h[0] as Record<string, unknown>;
  const { rows: l } = await db.query(OV_LINEAS_SQL, [numero]);
  return {
    numero: String(head.salesorder_number),
    cliente: (head.customer_name as string) ?? '',
    nit: (head.nit as string) ?? null,
    direccion: (head.direccion as string) ?? null,
    fecha: head.fecha as string,
    entrega: (head.entrega as string) ?? null,
    terminos: (head.terminos as string) ?? null,
    lineas: buildLineas(l as LineaRow[]),
    subtotal: n(head.sub_total),
    iva: n(head.iva),
    total: n(head.total),
  };
}
```

- [ ] **Step 4: Ver pasar** — Run: `npm run test --workspace=apps/hub-api -- detalle`. Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
npm run build --workspace=apps/hub-api
git add apps/hub-api/src/contabilidad/detalle.ts apps/hub-api/src/contabilidad/detalle.test.ts
git commit -m "feat(contabilidad): detalle de factura/OV (cabecera + lineas + totales)"
```

---

### Task 2: Endpoints GET factura/:numero y ov/:numero

**Files:**
- Modify: `apps/hub-api/src/contabilidad/router.ts`
- Modify: `apps/hub-api/src/contabilidad/router.test.ts`

- [ ] **Step 1: Tests** — en `router.test.ts`, dentro del describe del router, añadir:

```ts
describe('detalle', () => {
  it('GET /api/contabilidad/factura/:numero → 404 si no existe (fakePool vacío)', async () => {
    const res = await request(appConPool(fakePool()))
      .get('/api/contabilidad/factura/AM9999')
      .set('Authorization', `Bearer ${token(['contabilidad'])}`);
    expect(res.status).toBe(404);
  });
  it('GET /api/contabilidad/factura/:numero → 403 sin la app', async () => {
    const res = await request(appConPool(fakePool()))
      .get('/api/contabilidad/factura/AM1')
      .set('Authorization', `Bearer ${token([])}`);
    expect(res.status).toBe(403);
  });
});
```

(Usa los mismos helpers `appConPool`, `fakePool`, `token` del archivo. `fakePool` devuelve `{ rows: [] }` → header vacío → 404.)

- [ ] **Step 2: Ver fallar** — Run: `npm run test --workspace=apps/hub-api -- contabilidad/router`. Expected: FAIL (rutas no existen → 404 del router para la 403, y la 404 daría 404 por otra razón; el caso 403 fallará con 404).

- [ ] **Step 3: Router** — en `router.ts`:

(a) Import: añadir a la línea de imports de `./source.js`/módulos:
```ts
import { getDetalleFactura, getDetalleOV } from './detalle.js';
```

(b) Handlers (junto a los otros):
```ts
  router.get('/contabilidad/factura/:numero', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const d = await getDetalleFactura(db, req.params.numero);
      if (!d) return void res.status(404).json({ error: 'factura no encontrada' });
      res.json(d);
    } catch (e) {
      sendError(res, e, 'contabilidad_detalle_factura');
    }
  });

  router.get('/contabilidad/ov/:numero', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const d = await getDetalleOV(db, req.params.numero);
      if (!d) return void res.status(404).json({ error: 'ov no encontrada' });
      res.json(d);
    } catch (e) {
      sendError(res, e, 'contabilidad_detalle_ov');
    }
  });
```

- [ ] **Step 4: Ver pasar** — Run: `npm run test --workspace=apps/hub-api -- contabilidad`. Expected: PASS (todo contabilidad).

- [ ] **Step 5: Build + commit**

```bash
npm run build --workspace=apps/hub-api
git add apps/hub-api/src/contabilidad/router.ts apps/hub-api/src/contabilidad/router.test.ts
git commit -m "feat(contabilidad): endpoints de detalle factura/OV"
```

---

## Parte B — Frontend

### Task 3: api.ts — tipos + fetchers

**Files:**
- Modify: `apps/contabilidad/src/api.ts`

- [ ] **Step 1: Añadir tipos + funciones** (al final, antes de `esAdmin` o tras los fetchers):

```ts
export interface DetalleLinea { sku: string; nombre: string; cantidad: number; precio: number; total: number; }
export interface DetalleFactura {
  numero: string; cliente: string; nit: string | null; direccion: string | null;
  fecha: string; vencimiento: string | null; terminos: string | null; ov: string | null;
  saldo: number; lineas: DetalleLinea[]; subtotal: number; iva: number; total: number;
}
export interface DetalleOV {
  numero: string; cliente: string; nit: string | null; direccion: string | null;
  fecha: string; entrega: string | null; terminos: string | null;
  lineas: DetalleLinea[]; subtotal: number; iva: number; total: number;
}

export async function fetchFacturaDetalle(numero: string): Promise<DetalleFactura> {
  const res = await fetch(`${API_BASE}/api/contabilidad/factura/${encodeURIComponent(numero)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as DetalleFactura;
}

export async function fetchOVDetalle(numero: string): Promise<DetalleOV> {
  const res = await fetch(`${API_BASE}/api/contabilidad/ov/${encodeURIComponent(numero)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as DetalleOV;
}
```

- [ ] **Step 2: Build** — `npm run build --workspace=apps/contabilidad`. Expected: OK.
- [ ] **Step 3: Commit**

```bash
git add apps/contabilidad/src/api.ts
git commit -m "feat(contabilidad): api de detalle factura/OV"
```

---

### Task 4: DetalleModal.tsx

**Files:**
- Create: `apps/contabilidad/src/DetalleModal.tsx`

- [ ] **Step 1: Crear el componente** — `apps/contabilidad/src/DetalleModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, X } from 'lucide-react';
import { fetchFacturaDetalle, fetchOVDetalle, type DetalleFactura, type DetalleOV } from './api';
import { formatCOP } from './format';

type Detalle = (DetalleFactura & { _tipo: 'factura' }) | (DetalleOV & { _tipo: 'ov' });

interface Props { tipo: 'factura' | 'ov'; numero: string; onClose: () => void; }

export default function DetalleModal({ tipo, numero, onClose }: Props) {
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const p = tipo === 'factura'
      ? fetchFacturaDetalle(numero).then((d) => ({ ...d, _tipo: 'factura' as const }))
      : fetchOVDetalle(numero).then((d) => ({ ...d, _tipo: 'ov' as const }));
    p.then((d) => vivo && (setDetalle(d), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [tipo, numero]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-strong" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {tipo === 'factura' ? 'Factura' : 'Orden de venta'} {numero}
          </h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>

        {cargando && <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Cargando…</div>}
        {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</div>}

        {detalle && !cargando && (
          <div className="space-y-4">
            {/* Cabecera */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <Dato k="Cliente" v={detalle.cliente} />
              <Dato k="NIT" v={detalle.nit} />
              {detalle.direccion && <Dato k="Dirección" v={detalle.direccion} />}
              <Dato k="Fecha" v={detalle.fecha} />
              {detalle._tipo === 'factura' && <Dato k="Vencimiento" v={detalle.vencimiento} />}
              {detalle._tipo === 'ov' && <Dato k="Entrega" v={detalle.entrega} />}
              <Dato k="Términos" v={detalle.terminos} />
              {detalle._tipo === 'factura' && <Dato k="Orden de venta" v={detalle.ov} />}
              {detalle._tipo === 'factura' && <Dato k="Saldo" v={formatCOP(detalle.saldo)} />}
            </div>

            {/* Líneas */}
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold">SKU</th>
                    <th className="px-2 py-2 text-left font-semibold">DESCRIPCIÓN</th>
                    <th className="px-2 py-2 text-right font-semibold">UDS.</th>
                    <th className="px-2 py-2 text-right font-semibold">PRECIO</th>
                    <th className="px-2 py-2 text-right font-semibold">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detalle.lineas.map((l, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1 whitespace-nowrap font-medium">{l.sku || '—'}</td>
                      <td className="px-2 py-1">{l.nombre || '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{l.cantidad}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCOP(l.precio)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCOP(l.total)}</td>
                    </tr>
                  ))}
                  {detalle.lineas.length === 0 && (
                    <tr><td colSpan={5} className="px-2 py-4 text-center text-gray-400">Sin líneas.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Totales */}
            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <Total k="Subtotal" v={detalle.subtotal} />
              <Total k="IVA (19%)" v={detalle.iva} />
              <Total k="Total" v={detalle.total} fuerte />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-0.5">
      <span className="text-gray-500">{k}</span>
      <span className="text-right font-medium text-gray-900">{v || '—'}</span>
    </div>
  );
}

function Total({ k, v, fuerte }: { k: string; v: number; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? 'border-t border-gray-200 pt-1 text-base font-bold text-gray-900' : 'text-gray-600'}`}>
      <span>{k}</span>
      <span className="tabular-nums">{formatCOP(v)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Build** — `npm run build --workspace=apps/contabilidad`. Expected: OK.
- [ ] **Step 3: Commit**

```bash
git add apps/contabilidad/src/DetalleModal.tsx
git commit -m "feat(contabilidad): DetalleModal (factura/OV)"
```

---

### Task 5: Cablear el clic-para-detalle en las dos tablas

**Files:**
- Modify: `apps/contabilidad/src/FacturasTable.tsx`
- Modify: `apps/contabilidad/src/App.tsx`
- Modify: `apps/contabilidad/src/OVPendientes.tsx`

- [ ] **Step 1: FacturasTable — prop + clic de fila + stopPropagation en Cartera**

(a) Ampliar `Props`:
```ts
interface Props {
  facturas: FacturaContable[];
  onEditarCartera: (invoiceNumber: string, cartera: string) => void;
  guardando: string | null;
  onAbrirDetalle?: (invoiceNumber: string) => void;
}
```
(b) Firma: `export default function FacturasTable({ facturas, onEditarCartera, guardando, onAbrirDetalle }: Props) {`
(c) La fila:
```tsx
<tr
  key={f.invoiceNumber}
  onClick={() => onAbrirDetalle?.(f.invoiceNumber)}
  className="cursor-pointer hover:bg-blue-50/40"
>
```
(d) La celda de Cartera (la última `<td>`) detiene la propagación para no abrir el modal al editar:
```tsx
<td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
```

- [ ] **Step 2: App.tsx — estado del modal de factura + render**

(a) Import: `import DetalleModal from './DetalleModal';`
(b) Estado (junto a los demás `useState`):
```ts
const [detalleFactura, setDetalleFactura] = useState<string | null>(null);
```
(c) Pasar el handler al `<FacturasTable>`: añadir prop `onAbrirDetalle={setDetalleFactura}`.
(d) Renderizar el modal (dentro del `<>` de datos, tras `<OVPendientes/>` o al final del main):
```tsx
{detalleFactura && (
  <DetalleModal tipo="factura" numero={detalleFactura} onClose={() => setDetalleFactura(null)} />
)}
```

- [ ] **Step 3: OVPendientes — estado del modal de OV + clic de fila + render**

(a) Import: `import DetalleModal from './DetalleModal';`
(b) Estado: `const [detalleOV, setDetalleOV] = useState<string | null>(null);`
(c) La fila (la `<tr key={o.salesorder_number} ...>`): añadir `onClick={() => setDetalleOV(o.salesorder_number)}` y `cursor-pointer` a su className.
(d) Al final del `return` de la sección (tras el `</div>` de la tabla, dentro del fragmento), renderizar:
```tsx
{detalleOV && (
  <DetalleModal tipo="ov" numero={detalleOV} onClose={() => setDetalleOV(null)} />
)}
```
Asegúrate de que el `return` de OVPendientes envuelve todo en el `<section>`; el modal puede ir justo antes de cerrar `</section>`.

- [ ] **Step 4: Build** — `npm run build --workspace=apps/contabilidad`. Expected: OK.
- [ ] **Step 5: Commit**

```bash
git add apps/contabilidad/src/FacturasTable.tsx apps/contabilidad/src/App.tsx apps/contabilidad/src/OVPendientes.tsx
git commit -m "feat(contabilidad): clic en fila abre el detalle (factura/OV)"
```

---

## Parte C — Verificación

### Task 6: Build/test completo + verificación

- [ ] **Step 1: Backend** — `npm run build --workspace=apps/hub-api && npm run test --workspace=apps/hub-api -- contabilidad`. Expected: build limpio; tests contabilidad (domain + router + ovPendientes + detalle) verdes.
- [ ] **Step 2: Portal (type gate)** — `npm run build --workspace=apps/portal`. Expected: compila (type-chequea la app).
- [ ] **Step 3: Verificación BD (tras desplegar hub-api)** — el usuario (siempre `\c zoho-hub`): confirmar que una factura devuelve líneas:
```sql
SELECT it.sku, it.name, li.quantity, li.rate
  FROM books.invoice_line_items li
  JOIN books.invoices i ON i.invoice_id = li.invoice_id
  LEFT JOIN books.items it ON it.item_id = li.item_id
 WHERE i.invoice_number = 'AM1266'
 ORDER BY li.line_item_id;
```
- [ ] **Step 4: E2E** (tras desplegar hub-api + portal): clic en una fila de facturas → modal con líneas y totales que cuadran; clic en una OV pendiente → modal de la OV; editar la celda Cartera NO abre el modal.

---

## Notas para el implementador
- Tests filtrados (`-- detalle`, `-- contabilidad`); nunca la suite completa de hub-api.
- No tocar `salesOrders.ts` ni el endpoint compartido. No `npm install`. No tocar `apps/salestracker-pro`.
- Si `li.line_item_id` no existiera en `invoice_line_items` (poco probable), cambiar el `ORDER BY` por `it.name`; lo demás no cambia.
- El usuario usa PowerShell 5.1 (deploy/push sin `&&`).
