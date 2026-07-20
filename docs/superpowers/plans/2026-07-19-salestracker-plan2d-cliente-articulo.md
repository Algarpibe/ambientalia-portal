# salestracker → Portal — Plan 2D: página "Cliente × Artículo"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Portar la página **Cliente × Artículo** (`/salestracker/cliente-articulo`): tabla agrupada por cliente donde cada artículo coloca su importe neto en 1 de 4 macro-categorías (Mano de Obra/Cal, C&R, Equipos, Operación); fila de subtotales por cliente (con nombre enlazado a la ficha) e ítems debajo; fila GRAN TOTAL. Filtros: tipo OV/FAC, año, búsqueda. Modo **comparar** (año A vs B → columna Δ%). Export CSV/copiar.

**Architecture:** REUSA el endpoint `GET /api/salestracker/customer-item-sales` y `fetchCustomerItemSales` (creados en 2C) y la lib `customer-item.ts` (ya portada en 2C: `filterRows`, `groupByCustomer`, `computeGrandTotals`, `bucketForCategory`, `BUCKET_LABELS`, `customerItemToCsv`). Solo se porta la lib nueva `customer-item-compare.ts`. La página en **Tailwind plano + controles nativos** (sin shadcn; xlsx diferido, CSV+copiar). Nav ABSOLUTA (`APP_BASE`).

**Alcance:** solo esta página. No hay endpoints nuevos. Muy corto.

**Tech Stack:** sub-app Vite (React 19, react-router 7, @tanstack/react-query v5). Patrón idéntico a 2A/2B/2C.

---

## File Structure
**Frontend (`apps/salestracker/src/`):**
- `lib/customer-item-compare.ts` + `.test.ts` (portar verbatim de reference).
- `pages/ClienteArticulo.tsx` (nuevo) — la tabla agrupada.
- `pages/CustomerItemCompareTable.tsx` (nuevo) — sub-tabla comparación A/B.
- `components/Nav.tsx` (modificar) — enlace "Cliente × Artículo".
- `App.tsx` (modificar) — ruta `cliente-articulo`.

No cambia backend. `customer-item.ts`, `fetchCustomerItemSales`, `compare.ts` (formatDeltaPct/computeDelta), `format.ts` ya existen.

---

## Task 1: Portar `customer-item-compare.ts` + test

**Files:** Create `apps/salestracker/src/lib/customer-item-compare.ts` + `.test.ts`.

- [ ] **Step 1: Portar la lib (verbatim de `reference/salestracker-next/src/lib/customer-item-compare.ts`)**

Copiar el archivo cambiando SOLO los imports:
- `import type { CustomerItemRow } from "@/types/database"` → `import type { CustomerItemRow } from '../api'`
- `import { computeDelta } from "@/lib/compare"` → `import { computeDelta } from './compare'`

Resto **verbatim**. Exporta: `CustomerItemComparePoint`, `CustomerCompareGroup`, `buildCustomerItemCompare(rowsA, rowsB)`.

- [ ] **Step 2: Portar su test**

Copiar `reference/.../src/lib/__tests__/customer-item-compare.test.ts` → `apps/salestracker/src/lib/customer-item-compare.test.ts`, ajustando imports (`./customer-item-compare`, y tipo desde `../api`). Mantener todos los asserts.

- [ ] **Step 3: Verificar** `cd apps/salestracker && npx vitest run src/lib/customer-item-compare.test.ts` → pasa; `npx tsc --noEmit` → limpio.
- [ ] **Step 4: Commit** `feat(salestracker): portar lib customer-item-compare + test`.

---

## Task 2: Página ClienteArticulo + tabla de comparación + ruta/nav

**Files:** Create `pages/ClienteArticulo.tsx`, `pages/CustomerItemCompareTable.tsx`; Modify `Nav.tsx`, `App.tsx`.

**Comportamiento (de la página de referencia):** tabla agrupada por cliente. Columnas: SKU, Marca, Nombre, Categoría, Cantidad, y 4 columnas de bucket (Mano de Obra/Cal, C&R, Equipos, Operación). Por cada cliente: (a) una **fila de cabecera** (negrita, fondo gris) con el nombre del cliente (enlace a la ficha) ocupando las primeras 5 columnas + los 4 **subtotales de bucket** del cliente; (b) una **fila por artículo**: SKU/Marca/Nombre/Categoría/Cantidad + el `importe` colocado SOLO en la columna del bucket que le corresponde (`bucketForCategory(categoria)`), las otras 3 en blanco. Al final, fila **TOTAL (N clientes)** con los 4 grandes totales. Filtros: tipo (OV/FAC), año, búsqueda. Toggle **Comparar** → `CustomerItemCompareTable` (año A vs B). Export CSV/copiar. Estados carga/error.

- [ ] **Step 1: `CustomerItemCompareTable.tsx`** (Tailwind plano)

```tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCustomerItemSales, type RecordTypeIO } from '../api';
import { buildCustomerItemCompare } from '../lib/customer-item-compare';
import { formatUSD } from '../lib/format';
import { formatDeltaPct } from '../lib/compare';

export default function CustomerItemCompareTable({ tipo, anioA, anioB, search }: {
  tipo: RecordTypeIO; anioA: number; anioB: number; search: string;
}) {
  const qA = useQuery({ queryKey: ['customer-item-sales', tipo, anioA], queryFn: () => fetchCustomerItemSales({ tipo, anio: anioA }) });
  const qB = useQuery({ queryKey: ['customer-item-sales', tipo, anioB], queryFn: () => fetchCustomerItemSales({ tipo, anio: anioB }) });

  const groups = useMemo(() => {
    if (!qA.data || !qB.data) return [];
    const g = buildCustomerItemCompare(qA.data, qB.data);
    const q = search.trim().toLowerCase();
    if (!q) return g;
    return g.filter((grp) => grp.customer.toLowerCase().includes(q) ||
      grp.items.some((it) => (it.sku ?? '').toLowerCase().includes(q) || it.nombre.toLowerCase().includes(q)));
  }, [qA.data, qB.data, search]);

  if (qA.isLoading || qB.isLoading) return <div className="p-6 text-gray-500">Cargando comparación…</div>;
  if (qA.error || qB.error) return <div className="p-6 text-red-600">{((qA.error ?? qB.error) as Error).message}</div>;

  const deltaCls = (d: number | null) => `text-right ${(d ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`;

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">SKU</th>
            <th className="px-3 py-2 text-left">Nombre</th>
            <th className="px-3 py-2 text-right">{anioA}</th>
            <th className="px-3 py-2 text-right">{anioB}</th>
            <th className="px-3 py-2 text-right">Δ%</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <>
              <tr key={g.customer} className="bg-gray-100 font-semibold border-t">
                <td className="px-3 py-2" colSpan={2}>{g.customer}</td>
                <td className="px-3 py-2 text-right">{formatUSD(g.totalA)}</td>
                <td className="px-3 py-2 text-right">{formatUSD(g.totalB)}</td>
                <td className={`px-3 py-2 ${deltaCls(g.deltaPct)}`}>{formatDeltaPct(g.deltaPct)}</td>
              </tr>
              {g.items.map((it, i) => (
                <tr key={`${g.customer}-${it.sku ?? it.nombre}-${i}`} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{it.sku ?? '—'}</td>
                  <td className="px-3 py-2">{it.nombre}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(it.importeA)}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(it.importeB)}</td>
                  <td className={`px-3 py-2 ${deltaCls(it.deltaPct)}`}>{formatDeltaPct(it.deltaPct)}</td>
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```
> Nota React: usar `<Fragment key={g.customer}>` en lugar del `<>` sin key para evitar el warning de key en la lista de grupos. Importar `Fragment` de 'react' y envolver cada grupo.

- [ ] **Step 2: `ClienteArticulo.tsx`** (Tailwind plano + controles nativos)

Usa las libs (no reimplementar): `filterRows`, `groupByCustomer`, `computeGrandTotals`, `bucketForCategory`, `BUCKET_LABELS` de `../lib/customer-item`; `customerItemToCsv` de `../lib/customer-item`; `formatUSD` de `../lib/format`; `fetchCustomerItemSales` de `../api`; `APP_BASE` de `../appBase`. Detalles:
- Estado: `tipo` ('INVOICE'), `anio` (año actual), `search` (''), `comparar` (false), `anioA` (año actual), `anioB` (año actual−1).
- `const q = useQuery({ queryKey: ['customer-item-sales', tipo, anio], queryFn: () => fetchCustomerItemSales({ tipo, anio }), enabled: !comparar });`
- `const rows = q.data ?? []; const groups = groupByCustomer(filterRows(rows, search)); const grand = computeGrandTotals(groups);`
- Cabecera: `<h1>Ventas por cliente × artículo</h1>` + subtítulo "Por cliente, importe neto por artículo clasificado en 4 macro-categorías."
- Controles (nativos): `<select>` tipo (Facturas (FAC)→INVOICE / Órdenes de Venta (OV)→SALES_ORDER); en modo normal, `<input type="number" min={2000} max={anioActual}>` año (con `onChange={(e)=>setAnio(Number(e.target.value)||anioActual)}`); búsqueda `<input>` (placeholder "Buscar cliente, artículo o SKU…"); checkbox "Comparar años" → cuando ON, dos `<input type="number">` año A/B y render `<CustomerItemCompareTable tipo={tipo} anioA={anioA} anioB={anioB} search={search} />` en lugar de la tabla normal.
- Tabla normal (columnas): SKU, Marca, Nombre, Categoría, Cantidad, "Mano de Obra / Cal", "C&R", "Equipos", "Operación" (los 4 labels desde `BUCKET_LABELS.mano_obra/cr/equipos/operacion`). Cuerpo: por cada `g` de `groups`, envuelto en `<Fragment key={g.customer}>`:
  - Fila cabecera (`className="bg-gray-100 font-semibold border-t"`): primera celda `colSpan={5}` con `<Link to={`${APP_BASE}/clientes/${encodeURIComponent(g.customer)}`} className="text-blue-600 hover:underline">{g.customer}</Link>`; luego 4 celdas `text-right` con `formatUSD(g.totals.mano_obra/cr/equipos/operacion)`.
  - Filas de ítem: SKU (`font-mono text-xs`, `it.sku ?? '—'`), Marca (`it.marca ?? '—'`), Nombre, Categoría (`it.categoria ?? 'Sin categoría'`), Cantidad (`it.cantidad.toLocaleString('es-CO')`), y 4 celdas de bucket donde solo la de `bucketForCategory(it.categoria)` muestra `formatUSD(it.importe)` y el resto vacías.
  - Tras todos los grupos: fila TOTAL (`bg-gray-50 font-bold border-t-2`): `colSpan={5}` "TOTAL ({groups.length} clientes)" + 4 grandes totales `formatUSD(grand.mano_obra/...)`.
  - Si `groups.length === 0`: fila con `colSpan={9}` y mensaje "Sin ventas en el año seleccionado.".
- Export: "CSV" → `customerItemToCsv(groups, grand)` en Blob `text/csv;charset=utf-8`, filename `ventas_cliente_articulo_${tipo}_${anio}.csv`; "Copiar" → helper local `groupsToTsv(groups, grand)` (mismo layout de columnas que el CSV pero unido por `\t`; puedes derivarlo llamando a `customerItemToCsv` y reemplazando `;`→`\t` de forma segura, o escribir el TSV a mano). Deshabilitar si `groups.length === 0`.
- Estados: carga "Cargando…"; error `(q.error as Error).message`. Estilo plano como `Home/Articulos/Clientes` (`p-8 space-y-6`, tabla `w-full text-sm`, cabecera `bg-gray-50`). Sin shadcn.

- [ ] **Step 3: `Nav.tsx` — enlace** (tras "Clientes")
```tsx
      <NavLink to={`${APP_BASE}/cliente-articulo`} className={link}>Cliente × Artículo</NavLink>
```

- [ ] **Step 4: `App.tsx` — ruta** (dentro del Layout, tras `clientes/:customer`)
```tsx
        <Route path="cliente-articulo" element={<ClienteArticulo />} />
```
(`import ClienteArticulo from './pages/ClienteArticulo';`)

- [ ] **Step 5: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
Expected: compila, tests pasan, build del portal exit 0.

- [ ] **Step 6: Commit** `feat(salestracker): página Cliente × Artículo (buckets, comparar, export)`.

---

## Task 3: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
(hub-api NO cambia en 2D.)
- [ ] **Step 2: Handoff:** merge/push + redeploy **solo del portal** (no hay cambios en hub-api). Verificar en `/salestracker/cliente-articulo`: tabla agrupada por cliente con 4 columnas de bucket, subtotales, GRAN TOTAL, filtros, comparar A/B (Δ%), export CSV/copiar, y que el nombre de cliente enlaza a su ficha.

---

## Self-Review (cobertura)
- Lib `customer-item-compare` portada + test: T1. ✅
- Página agrupada (buckets, subtotales, gran total, filtros, comparar, export CSV/copiar) Tailwind plano: T2. ✅
- Nav absoluta + enlace a la ficha con APP_BASE (no customerHref): T2. ✅
- Reusa endpoint/fetcher/lib de 2C — sin backend nuevo. ✅
- Diferido: export xlsx (Plan de fundaciones). Anotado.

Sin placeholders. Tipos consistentes (`CustomerItemRow`, `CustomerCompareGroup`). Sin `item_id`.

## Próximos: Plan 2E (tablas, reusa `/sales`) · 3 (analítica pesada) · 4 (config/escritura) · 5 (cutover).
