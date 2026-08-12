# Contabilidad: indicio "facturable" (luces) en OV pendientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** En la sección "OV pendientes de facturar", mostrar por fila una o varias **luces de color** (🟢 despachada, 🟡 sólo paquete, 🔴 ticket por facturar) + leyenda + checkbox "Solo facturables". El cálculo vive en un endpoint propio de contabilidad; el endpoint compartido `/api/sales-orders/pending` NO se toca.

**Rama:** `feat/contabilidad-facturables`. **Spec:** `docs/superpowers/specs/2026-07-18-contabilidad-facturables-design.md`.

**Verificado contra la réplica:**
- Despacho en `books.sales_orders.raw`: `shipped_status ∈ {fulfilled, partially_shipped, pending, ''}`, `packages` (array). `shipment_date` NO sirve (puesto casi siempre).
- Ticket: `salesorder_id`/`orden_venta` del ticket están SIEMPRE vacíos; la única vía es OV→deal (`zcrm_potential_id`)→`crm.deals.numero_ticket`→`desk.tickets.number` (integer=numeric, sin cast). 339 OV enlazan por ahí. Estado exacto `Por Facturar` (hoy 0 con OV enlazada → la luz roja aún no encenderá, pero el mecanismo es correcto).

**Estado del código:**
- `apps/hub-api/src/salesOrders.ts`: `getPendingSalesOrders` + `aggregatePendingOrders` (NO tocar; lo usa el Conciliador). `ESTADOS_OV_POR_FACTURAR` en `apps/hub-api/src/salesOrderStatus.js`.
- `apps/hub-api/src/contabilidad/router.ts`: usa `cached`, `clearCache/clearCacheKey`, `requireAuth`, `requireApp(APP_ID)`, `sendError`. `APP_ID = 'contabilidad'`.
- `apps/contabilidad/src/api.ts`: `PendingSalesOrder` + `fetchOVPendientes()` (hoy apunta a `/api/sales-orders/pending`).
- `apps/contabilidad/src/OVPendientes.tsx`: tabla autocontenida con filtro estado+texto, orden por columnas y totales.

---

## Parte A — Backend

### Task 1: Módulo ovPendientes.ts (query + agregación + getter) con TDD

**Files:**
- Create: `apps/hub-api/src/contabilidad/ovPendientes.ts`
- Create: `apps/hub-api/src/contabilidad/ovPendientes.test.ts`

- [ ] **Step 1: Escribir el test primero** — `apps/hub-api/src/contabilidad/ovPendientes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateFacturables, type LineRow } from './ovPendientes.js';

const line = (over: Partial<LineRow>): LineRow => ({
  salesorder_id: 'so1',
  salesorder_number: 'OV-1',
  date: '2026-05-01',
  customer_name: 'ACME',
  status: 'open',
  currency_code: 'COP',
  shipment_date: null,
  shipped_status: 'pending',
  tiene_paquete: false,
  ticket_por_facturar: false,
  quantity: 2,
  rate: 100,
  cantidad_facturada: '0',
  cantidad_cancelada: '0',
  ...over,
});

describe('aggregateFacturables', () => {
  it('suma total y pendiente por orden (una fila por orden)', () => {
    const r = aggregateFacturables([
      line({ quantity: 2, rate: 100, cantidad_facturada: '1' }),
      line({ quantity: 1, rate: 50 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].total).toBe(250);            // 2*100 + 1*50
    expect(r[0].pending).toBe(150);          // (2-1)*100 + 1*50
  });

  it('despachada = shipped_status fulfilled o partially_shipped', () => {
    expect(aggregateFacturables([line({ shipped_status: 'fulfilled' })])[0].despachada).toBe(true);
    expect(aggregateFacturables([line({ shipped_status: 'partially_shipped' })])[0].despachada).toBe(true);
    expect(aggregateFacturables([line({ shipped_status: 'pending' })])[0].despachada).toBe(false);
  });

  it('soloPaquete = tiene paquete y NO despachada', () => {
    expect(aggregateFacturables([line({ tiene_paquete: true, shipped_status: 'pending' })])[0].soloPaquete).toBe(true);
    expect(aggregateFacturables([line({ tiene_paquete: true, shipped_status: 'fulfilled' })])[0].soloPaquete).toBe(false);
    expect(aggregateFacturables([line({ tiene_paquete: false })])[0].soloPaquete).toBe(false);
  });

  it('facturable = despachada OR soloPaquete OR ticketPorFacturar', () => {
    expect(aggregateFacturables([line({ shipped_status: 'pending', tiene_paquete: false, ticket_por_facturar: false })])[0].facturable).toBe(false);
    expect(aggregateFacturables([line({ ticket_por_facturar: true })])[0].facturable).toBe(true);
    expect(aggregateFacturables([line({ shipped_status: 'fulfilled' })])[0].facturable).toBe(true);
  });

  it('ordena por pendiente descendente', () => {
    const r = aggregateFacturables([
      line({ salesorder_id: 'a', salesorder_number: 'A', quantity: 1, rate: 10 }),
      line({ salesorder_id: 'b', salesorder_number: 'B', quantity: 1, rate: 90 }),
    ]);
    expect(r.map((o) => o.salesorder_number)).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Ver fallar** — Run: `npm run test --workspace=apps/hub-api -- ovPendientes`. Expected: FAIL (módulo no existe).

- [ ] **Step 3: Crear ovPendientes.ts** — `apps/hub-api/src/contabilidad/ovPendientes.ts`:

```ts
import type { Pool } from '@algarpibe/zoho-sync';
import { ESTADOS_OV_POR_FACTURAR } from '../salesOrderStatus.js';

// OV pendientes de facturar ENRIQUECIDAS con las señales "facturable" para la app
// Contabilidad. NO reusar en el Conciliador (ese usa salesOrders.ts sin joins).

export interface OVPendienteFacturable {
  salesorder_number: string;
  date: string;
  customer_name: string | null;
  status: string;
  currency_code: string | null;
  total: number;
  pending: number;
  shipment_date: string | null;
  despachada: boolean;        // shipped_status ∈ {fulfilled, partially_shipped}
  soloPaquete: boolean;       // tiene paquete && !despachada
  ticketPorFacturar: boolean; // ticket de la OV (vía deal) en estado 'Por Facturar'
  facturable: boolean;        // despachada || soloPaquete || ticketPorFacturar
}

// Una fila por LÍNEA de OV (mismo motivo que salesOrders.ts: cantidades en texto).
// shipped_status/tiene_paquete/ticket_por_facturar son por ORDEN (iguales en todas
// sus líneas), calculados en SQL.
export interface LineRow {
  salesorder_id: string;
  salesorder_number: string;
  date: string;
  customer_name: string | null;
  status: string;
  currency_code: string | null;
  shipment_date: string | null;
  shipped_status: string | null;
  tiene_paquete: boolean;
  ticket_por_facturar: boolean;
  quantity: number | null;
  rate: number | null;
  cantidad_facturada: string | null;
  cantidad_cancelada: string | null;
}

const SQL = `
  SELECT so.salesorder_id,
         so.salesorder_number,
         so.date::text                              AS date,
         so.customer_name,
         so.status,
         so.currency_code,
         NULLIF(so.raw ->> 'shipment_date', '')     AS shipment_date,
         so.raw ->> 'shipped_status'                AS shipped_status,
         (jsonb_typeof(so.raw -> 'packages') = 'array'
           AND jsonb_array_length(so.raw -> 'packages') > 0) AS tiene_paquete,
         EXISTS (
           SELECT 1
             FROM crm.deals d
             JOIN desk.tickets t ON t.number = d.numero_ticket
            WHERE d.id = NULLIF(so.raw ->> 'zcrm_potential_id', '')
              AND t.status = 'Por Facturar'
         )                                          AS ticket_por_facturar,
         li.quantity,
         li.rate,
         NULLIF(li.raw ->> 'quantity_invoiced', '') AS cantidad_facturada,
         NULLIF(li.raw ->> 'quantity_cancelled', '') AS cantidad_cancelada
    FROM books.sales_orders so
    LEFT JOIN books.salesorder_line_items li ON li.salesorder_id = so.salesorder_id
   WHERE so.status = ANY($1::text[])
   ORDER BY so.date, so.salesorder_number`;

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const DESPACHADO = new Set(['fulfilled', 'partially_shipped']);

/** Agrega las líneas a una fila por orden con las señales "facturable". */
export function aggregateFacturables(rows: LineRow[]): OVPendienteFacturable[] {
  const byId = new Map<string, OVPendienteFacturable>();
  for (const r of rows) {
    let o = byId.get(r.salesorder_id);
    if (!o) {
      const despachada = DESPACHADO.has(r.shipped_status ?? '');
      const soloPaquete = r.tiene_paquete && !despachada;
      o = {
        salesorder_number: r.salesorder_number,
        date: r.date,
        customer_name: r.customer_name,
        status: r.status,
        currency_code: r.currency_code,
        total: 0,
        pending: 0,
        shipment_date: r.shipment_date,
        despachada,
        soloPaquete,
        ticketPorFacturar: r.ticket_por_facturar,
        facturable: despachada || soloPaquete || r.ticket_por_facturar,
      };
      byId.set(r.salesorder_id, o);
    }
    const qty = num(r.quantity);
    const rate = num(r.rate);
    const pendienteUds = Math.max(0, qty - num(r.cantidad_facturada) - num(r.cantidad_cancelada));
    o.total += qty * rate;
    o.pending += pendienteUds * rate;
  }
  return [...byId.values()].sort((a, b) => b.pending - a.pending);
}

/** Consulta + agrega las OV por facturar con las señales "facturable". */
export async function getOVPendientesFacturables(db: Pool): Promise<OVPendienteFacturable[]> {
  const { rows } = await db.query(SQL, [[...ESTADOS_OV_POR_FACTURAR]]);
  return aggregateFacturables(rows as LineRow[]);
}
```

- [ ] **Step 4: Ver pasar** — Run: `npm run test --workspace=apps/hub-api -- ovPendientes`. Expected: PASS (5/5).

- [ ] **Step 5: Build + commit**

```bash
npm run build --workspace=apps/hub-api
git add apps/hub-api/src/contabilidad/ovPendientes.ts apps/hub-api/src/contabilidad/ovPendientes.test.ts
git commit -m "feat(contabilidad): OV pendientes con senales facturable (despacho + ticket)"
```

---

### Task 2: Endpoint GET /api/contabilidad/ov-pendientes

**Files:**
- Modify: `apps/hub-api/src/contabilidad/router.ts`

- [ ] **Step 1: Añadir el import** — junto a los imports de `./source.js`, añadir:

```ts
import { getOVPendientesFacturables } from './ovPendientes.js';
```

- [ ] **Step 2: Añadir el handler** — dentro de `createContabilidadRouter`, junto a los otros `router.get/put`:

```ts
  router.get('/contabilidad/ov-pendientes', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try {
      const orders = await cached('contabilidad:ov-pendientes', () => getOVPendientesFacturables(db));
      res.json({ orders });
    } catch (e) {
      sendError(res, e, 'contabilidad_ov_pendientes');
    }
  });
```

(Usa los mismos helpers ya importados: `cached`, `requireAuth`, `requireApp`, `APP_ID`, `sendError`. Si `Request`/`Response` no están importados en el archivo, reutiliza el tipo que ya usan los otros handlers.)

- [ ] **Step 3: Build** — Run: `npm run build --workspace=apps/hub-api` (timeout 300000). Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/contabilidad/router.ts
git commit -m "feat(contabilidad): endpoint GET /api/contabilidad/ov-pendientes"
```

---

## Parte B — Frontend

### Task 3: api.ts — tipo enriquecido + repuntar el fetch

**Files:**
- Modify: `apps/contabilidad/src/api.ts`

- [ ] **Step 1: Añadir el tipo** — tras la interfaz `PendingSalesOrder`:

```ts
export interface OVPendienteFacturable extends PendingSalesOrder {
  despachada: boolean;
  soloPaquete: boolean;
  ticketPorFacturar: boolean;
  facturable: boolean;
}
```

- [ ] **Step 2: Repuntar `fetchOVPendientes`** al nuevo endpoint y tipo — reemplazar la función `fetchOVPendientes` existente por:

```ts
/** Carga las OV pendientes con las señales "facturable" (endpoint propio de contabilidad). */
export async function fetchOVPendientes(): Promise<OVPendienteFacturable[]> {
  const res = await fetch(`${API_BASE}/api/contabilidad/ov-pendientes`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { orders?: OVPendienteFacturable[] };
  if (!Array.isArray(data.orders)) throw new Error('Formato inesperado del hub (OV pendientes).');
  return data.orders;
}
```

- [ ] **Step 3: Build** — Run: `npm run build --workspace=apps/contabilidad`. Expected: OK (o error SOLO en OVPendientes.tsx si TS se queja del tipo viejo; se arregla en Task 4). Vite no type-chequea, así que probablemente pase; el portón real es el build del portal en Task 5.

- [ ] **Step 4: Commit**

```bash
git add apps/contabilidad/src/api.ts
git commit -m "feat(contabilidad): tipo OVPendienteFacturable + fetch al endpoint propio"
```

---

### Task 4: OVPendientes.tsx — columna de luces + leyenda + "solo facturables"

**Files:**
- Modify: `apps/contabilidad/src/OVPendientes.tsx`

- [ ] **Step 1: Reemplazar OVPendientes.tsx COMPLETO** por:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, PackageOpen } from 'lucide-react';
import { fetchOVPendientes, type OVPendienteFacturable } from './api';
import { formatCOP } from './format';

type SortKey = keyof OVPendienteFacturable;

const ESTADO: Record<string, { texto: string; cls: string }> = {
  open: { texto: 'Abierta', cls: 'bg-blue-50 text-blue-700' },
  overdue: { texto: 'Vencida', cls: 'bg-red-50 text-red-700' },
  partially_invoiced: { texto: 'Parcial', cls: 'bg-amber-50 text-amber-700' },
};
const estadoDe = (s: string) => ESTADO[s] ?? { texto: s, cls: 'bg-gray-100 text-gray-600' };

const COLS: { key: SortKey; label: string; align: 'left' | 'right'; kind: 'text' | 'money' | 'estado' }[] = [
  { key: 'salesorder_number', label: 'OV', align: 'left', kind: 'text' },
  { key: 'customer_name', label: 'CLIENTE', align: 'left', kind: 'text' },
  { key: 'date', label: 'FECHA OV', align: 'left', kind: 'text' },
  { key: 'shipment_date', label: 'ENTREGA', align: 'left', kind: 'text' },
  { key: 'total', label: 'TOTAL ($)', align: 'right', kind: 'money' },
  { key: 'pending', label: 'POR FACTURAR ($)', align: 'right', kind: 'money' },
  { key: 'status', label: 'ESTADO', align: 'left', kind: 'estado' },
];

const LUZ = 'inline-block h-2.5 w-2.5 rounded-full';

function Luces({ o }: { o: OVPendienteFacturable }) {
  return (
    <div className="flex items-center gap-1">
      {o.despachada && <span title="Despachada (paquete y envío)" className={`${LUZ} bg-green-500`} />}
      {o.soloPaquete && <span title="Sólo paquete (sin enviar)" className={`${LUZ} bg-amber-400`} />}
      {o.ticketPorFacturar && <span title="Ticket por facturar" className={`${LUZ} bg-red-500`} />}
    </div>
  );
}

export default function OVPendientes() {
  const [ordenes, setOrdenes] = useState<OVPendienteFacturable[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState('todos');
  const [filtro, setFiltro] = useState('');
  const [soloFacturables, setSoloFacturables] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'pending', dir: -1 });

  useEffect(() => {
    let vivo = true;
    fetchOVPendientes()
      .then((o) => vivo && (setOrdenes(o), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, []);

  const filtradas = useMemo(() => {
    if (!ordenes) return [];
    const q = filtro.trim().toLowerCase();
    const arr = ordenes.filter((o) => {
      if (soloFacturables && !o.facturable) return false;
      if (estado !== 'todos' && o.status !== estado) return false;
      if (q && !(o.salesorder_number.toLowerCase().includes(q) || (o.customer_name ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av ?? '').localeCompare(String(bv ?? ''), 'es') * sort.dir;
    });
    return arr;
  }, [ordenes, estado, filtro, soloFacturables, sort]);

  const totales = useMemo(
    () => filtradas.reduce((a, o) => ({ n: a.n + 1, total: a.total + o.total, pending: a.pending + o.pending }), { n: 0, total: 0, pending: 0 }),
    [filtradas],
  );

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'pending' || key === 'total' ? -1 : 1 }));

  return (
    <section className="mt-10 space-y-3">
      <div className="flex items-center gap-2">
        <PackageOpen className="h-5 w-5 text-amber-600" />
        <h2 className="text-sm font-semibold text-gray-700">OV pendientes de facturar</h2>
      </div>

      {cargando && (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Cargando OV…</div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {ordenes && !cargando && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select className="rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="todos">Todos los estados</option>
              <option value="open">Abiertas</option>
              <option value="overdue">Vencidas</option>
              <option value="partially_invoiced">Parciales</option>
            </select>
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar OV o cliente…" className="w-64 rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none" />
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              <input type="checkbox" checked={soloFacturables} onChange={(e) => setSoloFacturables(e.target.checked)} />
              Solo facturables
            </label>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-gray-500">{totales.n} OV</span>
              <span className="text-gray-700">Total: <b className="tabular-nums">{formatCOP(totales.total)}</b></span>
              <span className="text-gray-700">Por facturar: <b className="tabular-nums">{formatCOP(totales.pending)}</b></span>
            </div>
          </div>

          {/* Leyenda de luces */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className={`${LUZ} bg-green-500`} /> Despachada</span>
            <span className="flex items-center gap-1"><span className={`${LUZ} bg-amber-400`} /> Sólo paquete</span>
            <span className="flex items-center gap-1"><span className={`${LUZ} bg-red-500`} /> Ticket por facturar</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">INDICIO</th>
                  {COLS.map((c) => (
                    <th key={c.key} onClick={() => toggleSort(c.key)} className={`cursor-pointer select-none px-2 py-2 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} hover:text-gray-900`}>
                      {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtradas.map((o) => (
                  <tr key={o.salesorder_number} className="hover:bg-amber-50/40">
                    <td className="px-2 py-1"><Luces o={o} /></td>
                    {COLS.map((c) => {
                      const v = o[c.key];
                      if (c.kind === 'money') return <td key={c.key} className="px-2 py-1 text-right tabular-nums">{formatCOP(v as number)}</td>;
                      if (c.kind === 'estado') {
                        const e = estadoDe(o.status);
                        return <td key={c.key} className="px-2 py-1"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${e.cls}`}>{e.texto}</span></td>;
                      }
                      return <td key={c.key} className="px-2 py-1 whitespace-nowrap">{String(v ?? '') || '—'}</td>;
                    })}
                  </tr>
                ))}
                {filtradas.length === 0 && (
                  <tr><td colSpan={COLS.length + 1} className="px-2 py-4 text-center text-gray-400">Sin OV pendientes con estos filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Build** — Run: `npm run build --workspace=apps/contabilidad`. Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add apps/contabilidad/src/OVPendientes.tsx
git commit -m "feat(contabilidad): luces de indicio + solo facturables en OV pendientes"
```

---

## Parte C — Verificación

### Task 5: Build/test completo + verificación

- [ ] **Step 1: Backend** — Run: `npm run build --workspace=apps/hub-api && npm run test --workspace=apps/hub-api -- contabilidad`. Expected: build limpio; tests de contabilidad (domain + router + ovPendientes) en verde.

- [ ] **Step 2: Frontend + portal (type gate)** — Run: `npm run build --workspace=apps/contabilidad && npm run build --workspace=apps/portal`. Expected: ambos compilan (el portal con `tsc -b` type-chequea la app).

- [ ] **Step 3: Verificación contra BD real (tras desplegar hub-api)** — el usuario (siempre `\c zoho-hub`):

```sql
-- OV pendientes con sus señales (muestra)
SELECT so.salesorder_number,
       so.raw->>'shipped_status' AS shipped,
       (jsonb_typeof(so.raw->'packages')='array' AND jsonb_array_length(so.raw->'packages')>0) AS tiene_paquete,
       EXISTS (SELECT 1 FROM crm.deals d JOIN desk.tickets t ON t.number=d.numero_ticket
                WHERE d.id=NULLIF(so.raw->>'zcrm_potential_id','') AND t.status='Por Facturar') AS ticket_pf
  FROM books.sales_orders so
 WHERE so.status = ANY(ARRAY['open','overdue','partially_invoiced'])  -- ajustar si ESTADOS_OV_POR_FACTURAR difiere
 ORDER BY so.date DESC LIMIT 30;
```

- [ ] **Step 4: E2E** (tras desplegar hub-api + portal, Ctrl+Shift+R): en la sección OV pendientes aparecen las luces (verde despachada, ámbar sólo paquete, roja ticket), la leyenda, y el checkbox "Solo facturables" filtra correctamente.

---

## Notas para el implementador

- NO tocar `apps/hub-api/src/salesOrders.ts` ni el endpoint `/api/sales-orders/pending` (los usa el Conciliador).
- Tests filtrados siempre (`-- ovPendientes`, `-- contabilidad`); nunca la suite completa de hub-api.
- El usuario usa **PowerShell 5.1** (deploy/push sin `&&`).
- No `npm install`.
