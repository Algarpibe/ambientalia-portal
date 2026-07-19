# Conciliador: modal de detalle de Factura / OV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Pasos con checkbox `- [ ]`.

## Diseño (confirmado en brainstorming)

Llevar el clic-para-detalle (ya hecho en la app Contabilidad) al **Conciliador de Pagos** (`apps/payment-reconciliation`):
- Clic en fila de la tabla **Conciliación** (facturas) → modal con el detalle de la factura.
- Clic en fila de la pestaña **Órdenes por Facturar** → modal con el detalle de la OV.

**Backend:** 2 endpoints **compartidos** con `requireAuth` (como el resto del Conciliador), que **reutilizan** las funciones ya existentes y testeadas `getDetalleFactura`/`getDetalleOV` de `apps/hub-api/src/contabilidad/detalle.ts`. No se duplica lógica ni se toca el endpoint gated de contabilidad.

**Frontend:** el Conciliador es una app aparte (no puede importar de contabilidad), así que se crea su propio `DetalleModal` + fetchers (mismo patrón de duplicación autocontenida del monorepo), con el estilo slate/indigo del Conciliador.

**Rama:** `feat/conciliador-detalle`.

**Estado del código:**
- `apps/hub-api/src/index.ts`: endpoints con `requireAuth` (p. ej. `app.get('/api/reconciliation/data', requireAuth, ...)`), usa `getHubPool()`. Ya existe un helper de error (mira cómo cierran los try/catch de los endpoints vecinos — usa el MISMO patrón; si hay `sendError`, úsalo; si no, replica el `catch` de `/api/reconciliation/data`).
- `apps/hub-api/src/contabilidad/detalle.ts`: exporta `getDetalleFactura(db, numero)` y `getDetalleOV(db, numero)` → `DetalleFactura | null` / `DetalleOV | null`.
- `apps/payment-reconciliation/src/App.tsx`: pestaña Conciliación; fila de factura en ~línea 745: `filteredAndSortedData.map((row, idx) => (<tr key={idx} className="hover:bg-slate-50/50 transition-colors">` — `row.invoiceNumber` disponible; celdas de solo lectura.
- `apps/payment-reconciliation/src/SalesOrdersPending.tsx`: fila de OV en ~línea 222: `sorted.map((o) => (<tr key={o.salesorder_number} className="border-t border-slate-100 hover:bg-slate-50">` — `o.salesorder_number` disponible.
- Formato dinero del Conciliador: `Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 })`.

---

## Task 1: Backend — 2 endpoints compartidos (requireAuth)

**Files:** Modify `apps/hub-api/src/index.ts`

- [ ] **Step 1: Import** — junto a los imports, añadir:
```ts
import { getDetalleFactura, getDetalleOV } from './contabilidad/detalle.js';
```

- [ ] **Step 2: Endpoints** — cerca de los otros `app.get('/api/...', requireAuth, ...)` (p. ej. tras `/api/sales-orders/pending`), añadir. Usa el MISMO manejo de error que los endpoints vecinos de este archivo:
```ts
app.get('/api/invoices/:numero/detail', requireAuth, async (req, res) => {
  try {
    const d = await getDetalleFactura(getHubPool(), req.params.numero);
    if (!d) return void res.status(404).json({ error: 'factura no encontrada' });
    res.json(d);
  } catch (e) {
    // usar el mismo helper/patrón de error que /api/reconciliation/data en este archivo
    sendError(res, e, 'invoice_detail');
  }
});

app.get('/api/sales-orders/:numero/detail', requireAuth, async (req, res) => {
  try {
    const d = await getDetalleOV(getHubPool(), req.params.numero);
    if (!d) return void res.status(404).json({ error: 'ov no encontrada' });
    res.json(d);
  } catch (e) {
    sendError(res, e, 'sales_order_detail');
  }
});
```
Nota: `/api/sales-orders/:numero/detail` (3 segmentos) NO colisiona con `/api/sales-orders/pending` (2 segmentos). Si en el archivo NO existe `sendError`, sustituye el `catch` por el idéntico al de `/api/reconciliation/data` (probablemente `res.status(500).json({ error: '...' })` con log).

- [ ] **Step 3: Build** — `npm run build --workspace=apps/hub-api` (timeout 300000). Expected: sin errores.
- [ ] **Step 4: Commit**
```bash
git add apps/hub-api/src/index.ts
git commit -m "feat(hub-api): endpoints compartidos de detalle factura/OV (requireAuth)"
```

---

## Task 2: Frontend — fetchers + DetalleModal (payment-reconciliation)

**Files:**
- Create `apps/payment-reconciliation/src/detalleApi.ts`
- Create `apps/payment-reconciliation/src/DetalleModal.tsx`

- [ ] **Step 1: detalleApi.ts** — tipos + fetchers (auth propio del Conciliador):
```ts
const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

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

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 404) throw new Error('No encontrado.');
  if (!res.ok) throw new Error(`No se pudo cargar el detalle (error ${res.status}).`);
  return (await res.json()) as T;
}
export const fetchFacturaDetalle = (numero: string) =>
  get<DetalleFactura>(`${API_BASE}/api/invoices/${encodeURIComponent(numero)}/detail`);
export const fetchOVDetalle = (numero: string) =>
  get<DetalleOV>(`${API_BASE}/api/sales-orders/${encodeURIComponent(numero)}/detail`);
```

- [ ] **Step 2: DetalleModal.tsx** — estilo slate/indigo del Conciliador:
```tsx
import { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { fetchFacturaDetalle, fetchOVDetalle, type DetalleFactura, type DetalleOV } from './detalleApi';

type Detalle = (DetalleFactura & { _t: 'factura' }) | (DetalleOV & { _t: 'ov' });
interface Props { tipo: 'factura' | 'ov'; numero: string; onClose: () => void; }

const money = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);

export default function DetalleModal({ tipo, numero, onClose }: Props) {
  const [d, setD] = useState<Detalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    const p = tipo === 'factura'
      ? fetchFacturaDetalle(numero).then((x) => ({ ...x, _t: 'factura' as const }))
      : fetchOVDetalle(numero).then((x) => ({ ...x, _t: 'ov' as const }));
    p.then((x) => vivo && (setD(x), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setLoading(false));
    return () => { vivo = false; };
  }, [tipo, numero]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-bold text-slate-800">
            {tipo === 'factura' ? 'Factura' : 'Orden de venta'} {numero}
          </h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={20} /></button>
        </div>

        {loading && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="animate-spin" size={18} /> Cargando…</div>}
        {error && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}</div>}

        {d && !loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <Dato k="Cliente" v={d.cliente} />
              <Dato k="NIT" v={d.nit} />
              {d.direccion && <Dato k="Dirección" v={d.direccion} />}
              <Dato k="Fecha" v={d.fecha} />
              {d._t === 'factura' && <Dato k="Vencimiento" v={d.vencimiento} />}
              {d._t === 'ov' && <Dato k="Entrega" v={d.entrega} />}
              <Dato k="Términos" v={d.terminos} />
              {d._t === 'factura' && <Dato k="Orden de venta" v={d.ov} />}
              {d._t === 'factura' && <Dato k="Saldo" v={money(d.saldo)} />}
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-left font-bold">SKU</th>
                    <th className="px-2 py-2 text-left font-bold">DESCRIPCIÓN</th>
                    <th className="px-2 py-2 text-right font-bold">UDS.</th>
                    <th className="px-2 py-2 text-right font-bold">PRECIO</th>
                    <th className="px-2 py-2 text-right font-bold">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.lineas.map((l, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1 whitespace-nowrap font-medium text-slate-700">{l.sku || '—'}</td>
                      <td className="px-2 py-1 text-slate-600">{l.nombre || '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{l.cantidad}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(l.precio)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(l.total)}</td>
                    </tr>
                  ))}
                  {d.lineas.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-400">Sin líneas.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <Total k="Subtotal" v={money(d.subtotal)} />
              <Total k="IVA (19%)" v={money(d.iva)} />
              <Total k="Total" v={money(d.total)} fuerte />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className="text-right font-medium text-slate-800">{v || '—'}</span>
    </div>
  );
}
function Total({ k, v, fuerte }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? 'border-t border-slate-200 pt-1 text-base font-bold text-slate-900' : 'text-slate-600'}`}>
      <span>{k}</span><span className="tabular-nums">{v}</span>
    </div>
  );
}
```

- [ ] **Step 3: Build** — `npm run build --workspace=apps/payment-reconciliation`. Expected: OK.
- [ ] **Step 4: Commit**
```bash
git add apps/payment-reconciliation/src/detalleApi.ts apps/payment-reconciliation/src/DetalleModal.tsx
git commit -m "feat(payment-reconciliation): DetalleModal + fetchers de detalle"
```

---

## Task 3: Wire el clic-para-detalle en las dos tablas

**Files:**
- Modify `apps/payment-reconciliation/src/App.tsx`
- Modify `apps/payment-reconciliation/src/SalesOrdersPending.tsx`

- [ ] **Step 1: App.tsx (Conciliación)**
  (a) Import: `import DetalleModal from './DetalleModal';`
  (b) Estado (junto a los otros `useState`): `const [detalleFactura, setDetalleFactura] = useState<string | null>(null);`
  (c) La fila de factura (≈línea 745-746): añadir `onClick` y `cursor-pointer`:
  ```tsx
  filteredAndSortedData.map((row, idx) => (
    <tr key={idx} onClick={() => setDetalleFactura(row.invoiceNumber)} className="cursor-pointer hover:bg-slate-50/50 transition-colors">
  ```
  (d) Renderizar el modal (al final del JSX del componente, antes de cerrar el `return`):
  ```tsx
  {detalleFactura && <DetalleModal tipo="factura" numero={detalleFactura} onClose={() => setDetalleFactura(null)} />}
  ```

- [ ] **Step 2: SalesOrdersPending.tsx (Órdenes por Facturar)**
  (a) Import: `import DetalleModal from './DetalleModal';`
  (b) Estado: `const [detalleOV, setDetalleOV] = useState<string | null>(null);`
  (c) La fila (≈línea 222-223): añadir `onClick` y `cursor-pointer`:
  ```tsx
  sorted.map((o) => (
    <tr key={o.salesorder_number} onClick={() => setDetalleOV(o.salesorder_number)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
  ```
  (d) Renderizar el modal al final del JSX (antes de cerrar el `return` del componente):
  ```tsx
  {detalleOV && <DetalleModal tipo="ov" numero={detalleOV} onClose={() => setDetalleOV(null)} />}
  ```
  Nota: si `SalesOrdersPending` se renderiza en modo `bare` dentro del widget, el modal igual funciona (portal fijo por `position:fixed`).

- [ ] **Step 3: Build** — `npm run build --workspace=apps/payment-reconciliation`. Expected: OK.
- [ ] **Step 4: Commit**
```bash
git add apps/payment-reconciliation/src/App.tsx apps/payment-reconciliation/src/SalesOrdersPending.tsx
git commit -m "feat(payment-reconciliation): clic en fila abre el detalle (factura/OV)"
```

---

## Task 4: Verificación

- [ ] **Step 1: hub-api** — `npm run build --workspace=apps/hub-api && npm run test --workspace=apps/hub-api -- contabilidad`. Expected: build limpio; tests de detalle (ya existentes) en verde.
- [ ] **Step 2: Portal (type gate)** — `npm run build --workspace=apps/portal`. Expected: compila (type-chequea payment-reconciliation).
- [ ] **Step 3: E2E** (tras desplegar hub-api + portal): en el Conciliador, clic en fila de la tabla Conciliación → modal con líneas y totales; clic en fila de "Órdenes por Facturar" → detalle de la OV.

---

## Notas
- Reutiliza `getDetalleFactura`/`getDetalleOV` — NO reescribas la lógica ni toques `contabilidad/detalle.ts`.
- Tests filtrados. No `npm install`. No tocar `apps/salestracker-pro`.
- El endpoint nuevo es `requireAuth` (consistente con los del Conciliador); no requiere que el usuario tenga la app contabilidad.
- Usuario en PowerShell 5.1 (deploy/push sin `&&`).
