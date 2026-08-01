# 4ª luz "Paquete por crear" — Implementation Plan

> Ejecutar con TDD. Pasos con checkbox `- [ ]`. Spec: `docs/superpowers/specs/2026-07-22-luz-paquete-por-crear-design.md`. Rama: `feat/luz-paquete-por-crear`.

**Goal:** luz 🔵 "Paquete por crear" en OV pendientes: OV sin despachar ni empaquetar cuyos artículos tienen stock disponible para armar el paquete completo.

**Criterio validado a mano (2026-07-22):** 15/32 OV `puede_armarse`; ~7 encienden la luz nueva.

**Estado del código:**
- `apps/hub-api/src/contabilidad/ovPendientes.ts`: `SQL` (una fila por línea de OV viva, con `shipped_status`/`tiene_paquete`/`ticket_por_facturar`/`ticket` por orden), `LineRow`, `OVPendienteFacturable`, `aggregateFacturables` (pura, con `DESPACHADO = {fulfilled, partially_shipped}`), `getOVPendientesFacturables`.
- Tests: `ovPendientes.test.ts` (5, con fixture `line()`), `router.test.ts`.
- Frontend: `apps/contabilidad/src/api.ts` (`OVPendienteFacturable`), `OVPendientes.tsx` (`Luces`, leyenda, `LUZ`).

---

## Task 1: Backend — flag `paquetePorCrear` (TDD)

**Files:** Modify `apps/hub-api/src/contabilidad/ovPendientes.ts`, `apps/hub-api/src/contabilidad/ovPendientes.test.ts`

- [ ] **Step 1: Tests primero** — en `ovPendientes.test.ts`:

(a) añadir `puede_armarse: false,` al fixture `line()` (junto a `ticket_por_facturar`).

(b) añadir este describe:

```ts
describe('paquetePorCrear', () => {
  it('true si puede armarse y NO está despachada ni tiene paquete', () => {
    const r = aggregateFacturables([line({ puede_armarse: true, shipped_status: 'pending', tiene_paquete: false })]);
    expect(r[0].paquetePorCrear).toBe(true);
    expect(r[0].facturable).toBe(true); // entra en "solo facturables"
  });

  it('false si ya está despachada (no tiene sentido "por crear")', () => {
    const r = aggregateFacturables([line({ puede_armarse: true, shipped_status: 'fulfilled' })]);
    expect(r[0].paquetePorCrear).toBe(false);
    expect(r[0].despachada).toBe(true);
  });

  it('false si ya tiene paquete', () => {
    const r = aggregateFacturables([line({ puede_armarse: true, shipped_status: 'pending', tiene_paquete: true })]);
    expect(r[0].paquetePorCrear).toBe(false);
    expect(r[0].soloPaquete).toBe(true);
  });

  it('false si no hay stock suficiente', () => {
    const r = aggregateFacturables([line({ puede_armarse: false, shipped_status: 'pending', tiene_paquete: false })]);
    expect(r[0].paquetePorCrear).toBe(false);
    expect(r[0].facturable).toBe(false);
  });
});
```

- [ ] **Step 2: Ver fallar** — Run: `npm run test --workspace=apps/hub-api -- ovPendientes`. Expected: FAIL (`paquetePorCrear` no existe).

- [ ] **Step 3: Implementar** — en `ovPendientes.ts`:

(a) `OVPendienteFacturable`: añadir tras `ticketPorFacturar`:
```ts
  paquetePorCrear: boolean;   // hay stock disponible para armar el paquete (y aún no está despachada/empaquetada)
```
(b) `LineRow`: añadir tras `ticket_por_facturar`:
```ts
  puede_armarse: boolean;
```
(c) **SQL** — anteponer los CTE y añadir la columna. Reemplazar `const SQL = \`` … `FROM books.sales_orders so` por:

```ts
const SQL = `
  WITH pend AS (
    -- Líneas aún por despachar de TODAS las OV vivas (base del comprometido).
    SELECT so2.salesorder_id, li2.item_id,
           GREATEST(COALESCE(li2.quantity, 0)
                    - COALESCE(NULLIF(li2.raw ->> 'quantity_delivered', '')::numeric, 0)
                    - COALESCE(NULLIF(li2.raw ->> 'quantity_cancelled', '')::numeric, 0), 0) AS falta
      FROM books.sales_orders so2
      JOIN books.salesorder_line_items li2 ON li2.salesorder_id = so2.salesorder_id
     WHERE so2.status = ANY($1::text[])
  ), comp AS (
    -- Comprometido por artículo = suma de lo pendiente en todas las OV vivas.
    SELECT item_id, SUM(falta) AS comprometido FROM pend GROUP BY item_id
  ), armable AS (
    -- ¿Alcanza el stock DISPONIBLE para todas las líneas pendientes de la OV?
    -- Disponible = físico − comprometido por OTRAS OV (se resta la propia 'falta').
    -- Los ítems de servicio (track_inventory=false) no tienen stock → no bloquean.
    SELECT p.salesorder_id,
           bool_and(
             COALESCE(NULLIF(it.raw ->> 'track_inventory', '')::boolean, true) = false
             OR COALESCE(NULLIF(it.raw ->> 'actual_available_stock', '')::numeric, 0)
                - (COALESCE(c.comprometido, 0) - p.falta) >= p.falta
           ) AS puede_armarse
      FROM pend p
      LEFT JOIN books.items it ON it.item_id = p.item_id
      LEFT JOIN comp c ON c.item_id = p.item_id
     WHERE p.falta > 0
     GROUP BY p.salesorder_id
  )
  SELECT so.salesorder_id,
```
…(el resto del SELECT queda igual)… y añadir la columna nueva justo antes de `li.quantity,`:
```ts
         COALESCE(arm.puede_armarse, false)          AS puede_armarse,
```
y el join, tras `LEFT JOIN books.salesorder_line_items li ON li.salesorder_id = so.salesorder_id`:
```ts
    LEFT JOIN armable arm ON arm.salesorder_id = so.salesorder_id
```

(d) `aggregateFacturables` — dentro del `if (!o)`, tras calcular `soloPaquete`:
```ts
      const paquetePorCrear = r.puede_armarse && !despachada && !soloPaquete;
```
y en el objeto `o = {...}` añadir `paquetePorCrear,` y cambiar `facturable` por:
```ts
        facturable: despachada || soloPaquete || r.ticket_por_facturar || paquetePorCrear,
```

- [ ] **Step 4: Ver pasar** — Run: `npm run test --workspace=apps/hub-api -- ovPendientes`. Expected: PASS (9).
- [ ] **Step 5: Build + commit**
```bash
npm run build --workspace=apps/hub-api
git add apps/hub-api/src/contabilidad/ovPendientes.ts apps/hub-api/src/contabilidad/ovPendientes.test.ts
git commit -m "feat(contabilidad): flag paquetePorCrear (stock disponible para armar la OV)"
```

---

## Task 2: Frontend — 4ª luz azul

**Files:** Modify `apps/contabilidad/src/api.ts`, `apps/contabilidad/src/OVPendientes.tsx`

- [ ] **Step 1: api.ts** — en `OVPendienteFacturable` añadir tras `ticketPorFacturar`:
```ts
  paquetePorCrear: boolean;
```
- [ ] **Step 2: OVPendientes.tsx** — en el componente `Luces`, añadir tras la luz roja:
```tsx
      {o.paquetePorCrear && <span title="Paquete por crear (hay stock disponible)" className={`${LUZ} bg-blue-500`} />}
```
y en la leyenda, tras "Ticket por facturar":
```tsx
            <span className="flex items-center gap-1"><span className={`${LUZ} bg-blue-500`} /> Paquete por crear</span>
```
- [ ] **Step 3: Builds** — Run: `npm run build --workspace=apps/contabilidad && npm run build --workspace=apps/portal`. Expected: ambos OK (el portal es el type-gate real).
- [ ] **Step 4: Commit**
```bash
git add apps/contabilidad/src/api.ts apps/contabilidad/src/OVPendientes.tsx
git commit -m "feat(contabilidad): luz azul 'Paquete por crear' en OV pendientes"
```

---

## Task 3: Verificación

- [ ] **Step 1: Backend** — `npm run build --workspace=apps/hub-api && npm run test --workspace=apps/hub-api -- contabilidad`. Expected: build limpio, tests verdes.
- [ ] **Step 2: Portal** — `npm run build --workspace=apps/portal`. Expected: compila.
- [ ] **Step 3: E2E** (tras desplegar hub-api + portal, Ctrl+Shift+R): en OV pendientes, las OV **OV-2026-128/132/135/137/138/139/144** muestran 🔵; las que ya tienen 🟢/🟡 NO muestran azul; la leyenda incluye "Paquete por crear"; "Solo facturables" las incluye.

## Notas
- No tocar `apps/portal/tailwind.config.js` (contabilidad ya está en el `content`; `bg-blue-500` se generará).
- Tests filtrados siempre. No `npm install`. Usuario en PowerShell 5.1.
