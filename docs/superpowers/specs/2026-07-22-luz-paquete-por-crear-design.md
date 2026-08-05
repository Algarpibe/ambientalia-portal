# Diseño — 4ª luz "Paquete por crear" en OV pendientes

**Fecha:** 2026-07-22
**Base:** amplía las luces de indicio de la sección "OV pendientes de facturar" (app `contabilidad`). Ver [2026-07-18-contabilidad-facturables-design.md](2026-07-18-contabilidad-facturables-design.md).

## Objetivo

Añadir una cuarta luz 🔵 **"Paquete por crear"**: OV que aún no se despachan ni tienen paquete, pero cuyos artículos **están en stock disponible** → se puede armar el paquete ya. Convierte filas hoy "sin indicio" en accionables.

## Decisiones (brainstorming)

- **Stock a comparar:** *disponible* = `actual_available_stock − comprometido por OTRAS OV vivas` (no el físico a secas). Mismo criterio que la app de Inventario; evita marcar varias OV que compiten por el mismo stock. El comprometido de la propia OV NO se descuenta a sí misma.
- **Parciales:** la luz enciende **solo si alcanza para TODAS** las líneas pendientes (si se enciende, el paquete se puede armar completo).
- **Color:** 🔵 azul (verde/ámbar/rojo ya usados).
- **Exclusividad:** solo si NO hay 🟢 despachada ni 🟡 sólo-paquete. Compatible con 🔴 ticket (pueden coexistir).

## Validado contra datos reales (2026-07-22)

Consulta de validación sobre las 32 OV vivas con líneas pendientes: **15 `puede_armarse=true` / 17 `false`** → el criterio discrimina (no marca todo). Cruzando con las luces actuales, **~7 OV** encenderían la luz nueva (OV-2026-128/132/135/137/138/139/144): hoy se ven sin indicio y en realidad están listas para armar.

## Datos

- Líneas pendientes por OV: `books.salesorder_line_items` → `falta = GREATEST(quantity − raw->>'quantity_delivered' − raw->>'quantity_cancelled', 0)`.
- Stock físico del artículo: `books.items.raw->>'actual_available_stock'` (Zoho NO sincroniza `committed_stock`; por eso el comprometido se deriva de las OV — gotcha ya conocido en `apps/hub-api/src/inventory.ts`).
- Comprometido por artículo = `SUM(falta)` de TODAS las OV vivas (estados `open|overdue|partially_invoiced`).
- Ítems de servicio (`raw->>'track_inventory' = false`): no tienen stock → **no bloquean** (cuentan como disponibles).

## Criterio (por OV)

```
lineasProducto = líneas con falta > 0 cuyo item tiene product_type = 'goods'
                 (los servicios se EXCLUYEN: no se despachan)

puedeArmarse = existe al menos 1 linea de producto
               AND para TODAS ellas:
                   tieneSeguimiento(item)                                        -- si no, no se puede confirmar
                   AND (stockFisico(item) − (comprometidoTotal(item) − falta_de_esta_OV)) >= falta

paquetePorCrear = puedeArmarse AND NOT despachada AND NOT soloPaquete
```

**CORRECCIÓN 2026-08-04 (falso positivo real):** la versión inicial eximía a todo ítem con
`track_inventory=false` asumiendo que era un servicio. Pero hay **mercancía sin seguimiento**
(p. ej. `CIL-MULT-CA05-1.4M3`, "Botellas Gases", `product_type='goods'` + `track_inventory=false`),
y la luz encendía en falso (OV-2026-146). Ahora se distingue por `product_type`: los servicios se
ignoran, y un producto sin seguimiento **bloquea** porque no hay stock que consultar. Ante la duda,
no se marca — es preferible no señalar una OV que mandar a bodega a armar algo que no hay.

## Implementación

### Backend (`apps/hub-api/src/contabilidad/ovPendientes.ts`)
- El SQL gana un CTE `pend` (líneas pendientes de OV vivas) + `comp` (comprometido por artículo) y expone por orden un booleano `puede_armarse` (mismo cálculo validado a mano).
- `LineRow` gana `puede_armarse: boolean`; `OVPendienteFacturable` gana `paquetePorCrear: boolean`.
- En `aggregateFacturables`: `paquetePorCrear = puede_armarse && !despachada && !soloPaquete`, y entra en `facturable` (para el checkbox "Solo facturables").

### Frontend (`apps/contabilidad/src/`)
- `api.ts`: `OVPendienteFacturable` gana `paquetePorCrear`.
- `OVPendientes.tsx`: cuarta luz `bg-blue-500` con tooltip "Paquete por crear (hay stock)" + entrada en la leyenda.
- **Recordatorio:** las clases nuevas de Tailwind (`bg-blue-500`) las genera el portal porque `apps/contabilidad` ya está en el `content` de `apps/portal/tailwind.config.js` (se arregló al añadir las luces). No hace falta tocarlo.

## Alcance / fuera de alcance

- **En alcance:** cálculo en el SQL, flag nuevo, luz + leyenda, inclusión en `facturable`.
- **Fuera:** mostrar QUÉ artículo falta (tooltip detallado), reservar stock, crear el paquete desde la app, y el caso parcial (alcanza para algunas líneas).

## Criterios de éxito

- Las ~7 OV identificadas en la validación encienden 🔵 y las que ya tienen 🟢/🟡 NO la encienden.
- Una OV sin stock suficiente en alguna línea no enciende.
- Las OV de solo servicios (sin `track_inventory`) no se bloquean por stock.
- "Solo facturables" incluye las de luz azul.

## Riesgos

- **Doble conteo del comprometido:** si no se resta `falta` de la propia OV, ninguna OV alcanzaría nunca. El SQL debe restar `(comprometidoTotal − falta_de_esta_OV)`. Cubierto por test.
- `actual_available_stock` puede venir vacío en artículos no inventariables → `COALESCE(...,0)`, y el flag `track_inventory=false` los exime.
- El cálculo añade dos CTE al SQL de OV pendientes (endpoint cacheado, ~30 OV): impacto despreciable.
