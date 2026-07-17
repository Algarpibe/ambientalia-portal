# Diseño — Órdenes de Venta por Facturar (Conciliador de Pagos)

## Objetivo

Visualizar las órdenes de venta (OV) pendientes de facturar —tanto **sin facturar**
como **parcialmente facturadas**— dentro de la app Conciliador de Pagos, y como
widget en el dashboard del portal.

## Definición de "por facturar"

Una OV está "por facturar" si su estado en Zoho es uno de los **estados vivos**:
`open`, `overdue`, `partially_invoiced`. Se dejan fuera `invoiced`, `void`, `draft`,
`pending_approval`. Es la MISMA definición que ya usa WO-sales
(`estadosVivos` en `apps/hub-api/src/wo-sales/config.ts`); se extrae a una constante
compartida para que ambas features no puedan contradecirse.

- **Sin facturar** = `open` / `overdue` (nada facturado aún).
- **Parcial** = `partially_invoiced`.

## Arquitectura (3 fases)

### Fase 1 — Backend (hub-api)

Nuevo endpoint `GET /api/sales-orders/pending` (con `requireAuth`).

- Consulta `books.sales_orders` + `books.salesorder_line_items` filtrando por los
  estados vivos, y **agrega por orden**.
- Respuesta: array de órdenes con
  `{ salesorder_number, fecha, customer_name, status, currency_code, total, pendiente, fecha_entrega }`.
  - `total` = Σ (cantidad × tarifa) de las líneas.
  - `pendiente` = Σ ((cantidad − facturada − cancelada) × tarifa). Es el valor
    que aún no se ha facturado; el dato accionable que Zoho no da directo.
- `quantity_invoiced` / `quantity_cancelled` vienen como **texto** dentro de `raw`
  (gotcha ya conocido de WO-sales/hub.source.ts): se parsean con cuidado, no `::numeric`
  en SQL.
- La agregación (total y pendiente por orden a partir de sus líneas) va en una
  **función pura testeable**.

### Fase 2 — App Conciliador: pestaña "Órdenes por Facturar"

- Nueva pestaña junto a Conciliación / Análisis General / KPIs.
- Tabla: Fecha · OV# · Cliente · Estado (badge Sin facturar / Parcial) · Total ·
  **Pendiente por facturar** · Fecha de entrega.
- Filtros: por cliente y por estado. Orden por fecha o por pendiente.
- Cabecera: nº de órdenes y valor total pendiente.
- Self-fetch al endpoint con Bearer (`ambientalia_token`) y `VITE_HUB_API_URL`.

### Fase 3 — Dashboard: widget "Órdenes por Facturar"

- Widget seleccionable en `payment-reconciliation/src/widgets/`.
- Versión compacta: KPI (nº órdenes + valor pendiente total) + top órdenes por
  pendiente. Mismo patrón que los widgets ya existentes del Conciliador.
- Self-fetch al mismo endpoint.

## Errores y estados

- Endpoint bajo `requireAuth`; si zoho-hub falla → 500 y la UI muestra su estado de error.
- App y widget: estados loading / error / vacío como en el resto.

## Testing

- hub-api: test unitario de la función de agregación (total y pendiente por orden) y
  de la clasificación de estado (sin facturar / parcial). El CI de hub-api ya corre tests.
- Frontend: mínimo; la lógica pesada vive en el endpoint.

## Fidelidad / validación

El nº de órdenes y el desglose deben cuadrar con la vista "Órdenes de venta por
facturar" de Zoho. Validación en vivo por el usuario tras desplegar cada fase.

## Notas de despliegue

Toca **hub-api** (servicio aparte del portal): la Fase 1 requiere redesplegar hub-api,
no solo el portal. Fases 2 y 3 son solo portal.
