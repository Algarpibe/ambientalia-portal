# Diseño — Indicio "facturable" (luces) en OV pendientes

**Fecha:** 2026-07-18
**Base:** amplía la sección "OV pendientes de facturar" de la app `contabilidad` (ya desplegada). Ver [2026-07-18-contabilidad-filtros-design.md](2026-07-18-contabilidad-filtros-design.md).

## Objetivo

En la tabla de OV pendientes, mostrar una **luz de color por fila** que señale cuándo esa OV tiene indicios de estar lista para facturar, distinguiendo el motivo. Ayuda al usuario a priorizar qué facturar.

## Decisiones tomadas (brainstorming)

- Indicio se muestra en **OV pendientes** (no en el cuadro de facturas: allí ya están facturadas).
- **Luces de color** por fila (no sombreado de fila completa):
  - 🟢 **Despachada** — `shipped_status IN ('fulfilled','partially_shipped')` (paquete y envío / parcial).
  - 🟡 **Sólo paquete** — tiene paquete (`packages` array no vacío) y NO está despachada.
  - 🔴 **Ticket "Por Facturar"** — el ticket de la OV está en estado `Por Facturar`.
- Si una OV cumple varias, se muestran **varias luces** (cada una con tooltip). Sin prioridad ni fondos.
- Checkbox **"Solo facturables"**: filtra a las OV con ≥1 luz.
- El cálculo vive en un **endpoint propio de contabilidad** (no se toca el `/api/sales-orders/pending` compartido con el Conciliador).

## Datos (verificado contra la réplica)

- No hay tablas de paquetes/envíos: el despacho está en `books.sales_orders.raw`.
  - `shipped_status`: `fulfilled` | `partially_shipped` | `pending` | `''` (void/draft).
  - `packages`: array JSON (paquetes creados). `shipment_date` NO sirve (está puesto casi siempre, es fecha prevista).
  - `zcrm_potential_id`: enlace al deal de CRM.
- Ticket: `books.sales_orders.raw->>'zcrm_potential_id'` → `crm.deals.id` → `crm.deals.numero_ticket` → `desk.tickets.number` → `desk.tickets.status`. Estado exacto: **`Por Facturar`** (confirmado; hay tickets en ese estado).

## 1. Backend — endpoint propio enriquecido

Nuevo módulo `apps/hub-api/src/contabilidad/ovPendientes.ts` y endpoint `GET /api/contabilidad/ov-pendientes` (`requireAuth` + `requireApp('contabilidad')`, cacheado).

Reutiliza el patrón de `salesOrders.ts` (una fila por línea de OV → se agrega por orden en TS), pero la consulta añade por orden:
- `shipped_status` (de `so.raw`),
- presencia de paquete (`jsonb_typeof(so.raw->'packages')='array' AND jsonb_array_length(...) > 0`),
- estado del ticket vía `LEFT JOIN crm.deals` (por `zcrm_potential_id`) `LEFT JOIN desk.tickets` (por `numero_ticket`), quedándose con si `status = 'Por Facturar'`.

Contrato de salida (por OV):

```ts
export interface OVPendienteFacturable {
  salesorder_number: string;
  date: string;
  customer_name: string | null;
  status: string;
  currency_code: string | null;
  total: number;
  pending: number;
  shipment_date: string | null;
  // señales nuevas
  despachada: boolean;        // shipped_status ∈ {fulfilled, partially_shipped}
  soloPaquete: boolean;       // tiene paquete && !despachada
  ticketPorFacturar: boolean; // ticket.status = 'Por Facturar'
  facturable: boolean;        // despachada || soloPaquete || ticketPorFacturar
}
```

Respuesta: `{ orders: OVPendienteFacturable[] }` (mismo envoltorio `{ orders }` que el endpoint compartido, para que el frontend cambie de URL con mínimo esfuerzo).

**El endpoint compartido `/api/sales-orders/pending` NO se modifica** (el Conciliador sigue igual). La lógica "facturable" queda aislada en el módulo de contabilidad.

### Join del ticket (a verificar en el plan)
`crm.deals.numero_ticket` es numérico y `desk.tickets.number` puede ser texto; el plan confirma los tipos y castea de forma segura (p. ej. `t.number = d.numero_ticket::text` o casteo inverso con guarda). Si el tipo no casa, se ajusta el cast; es un detalle acotado.

## 2. Frontend — luces + filtro

`apps/contabilidad/src/OVPendientes.tsx` pasa a llamar a `/api/contabilidad/ov-pendientes` y:
- Añade una columna **"Indicio"** con una o varias **luces** (círculos de color con `title` tooltip):
  - 🟢 verde = Despachada, 🟡 ámbar = Sólo paquete, 🔴 rojo = Ticket por facturar.
  - Se renderizan las que apliquen (0, 1, 2 o 3 luces).
- Pequeña **leyenda** de los tres colores encima de la tabla.
- Checkbox **"Solo facturables"** que filtra a `facturable === true`.
- El resto de la tabla (orden, filtro de estado/texto, totales) se mantiene.

`api.ts`: el tipo `PendingSalesOrder` se amplía (o se añade `OVPendienteFacturable`) con los 4 flags, y `fetchOVPendientes` apunta al nuevo endpoint.

## 3. Alcance / fuera de alcance

- **En alcance:** endpoint propio con las 3 señales, columna de luces, leyenda, checkbox "solo facturables".
- **Fuera:** acciones desde la fila (crear factura, abrir en Zoho); definir "facturable" con otros criterios; tocar el cuadro de facturas.

## 4. Criterios de éxito

- Una OV `fulfilled`/`partially_shipped` muestra luz verde; una con paquete pero sin despachar, ámbar; una cuyo ticket está en `Por Facturar`, roja; combinaciones muestran varias luces.
- `pending` sin paquete y sin ticket por facturar → sin luces (y oculta con "Solo facturables").
- El Conciliador (`/api/sales-orders/pending`) sigue funcionando igual (endpoint intacto).

## 5. Riesgos

- El join OV→deal→ticket depende de que `zcrm_potential_id` esté poblado en la OV (como pasó con las facturas, suele estarlo, pero puede faltar en algunas → esas no tendrán luz roja aunque tengan ticket).
- `packages` podría venir vacío en la réplica si el sync trajo la vista de lista en vez del detalle; el plan verifica que `packages`/`shipped_status` estén poblados en OV reales antes de dar por bueno el criterio.
