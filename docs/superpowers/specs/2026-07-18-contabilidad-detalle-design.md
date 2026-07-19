# Diseño — Modal de detalle de Factura / OV en Contabilidad

**Fecha:** 2026-07-18
**Base:** amplía la app `contabilidad` (tabla de facturas + sección OV pendientes). Clic en una fila abre un modal con el detalle.

## Objetivo

Al hacer clic en una fila:
- de la **tabla de facturas** → modal con el detalle de la factura (cabecera + líneas SKU/uds/precio/total + subtotal/IVA/total).
- de la **sección OV pendientes** → modal con el detalle de la orden de venta.

Estilo limpio del portal (NO se replica la plantilla "Factura Proforma" de Zoho ni el logo — decisión tomada en brainstorming).

## Datos (verificado leyendo el código existente)

- **Factura**: `books.invoices` (invoice_id, customer_id, date, due_date, sub_total, total, reference_number, raw). IVA = `raw->>'tax_total'`; saldo = `raw->>'balance'`; términos = `raw->>'payment_terms_label'`; dirección = `raw->'billing_address'`.
- **OV**: `books.sales_orders` (salesorder_id, customer_id, date, sub_total, total, raw). entrega = `raw->>'shipment_date'`; términos = `raw->>'payment_terms_label'`.
- **NIT/dirección cliente**: `books.contacts` join por `customer_id = contact_id` (`c.nit`).
- **Líneas**: `books.invoice_line_items` (por `invoice_id`) / `books.salesorder_line_items` (por `salesorder_id`) → `books.items` (por `item_id`) para `sku` + `name`. `li.quantity`, `li.rate` (COP). Total de línea = `quantity * rate`.

## 1. Backend — 2 endpoints (gated `requireApp('contabilidad')`)

Nuevo módulo `apps/hub-api/src/contabilidad/detalle.ts` + 2 handlers en `router.ts`:
- `GET /api/contabilidad/factura/:numero` → `DetalleFactura`
- `GET /api/contabilidad/ov/:numero` → `DetalleOV`

Cada uno hace 2 consultas (cabecera + líneas) y arma el objeto. La composición de líneas (total por línea, subtotal) es una función **pura y testeable** (`buildLineas`).

Contratos:

```ts
export interface DetalleLinea {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number;   // COP
  total: number;    // cantidad * precio
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
```

`:numero` no existe → 404. La dirección se compone de `raw->'billing_address'` (`address` + `city`), fallback vacío.

## 2. Frontend

- **`DetalleModal.tsx`** (nuevo): overlay + tarjeta. Cabecera con nº + tipo (Factura/OV), bloque de datos (cliente, NIT, dirección · fecha, vencimiento/entrega, términos, OV · saldo si aplica), tabla de líneas (SKU · Descripción · Uds · Precio · Total), y pie Subtotal / IVA / Total. Cierra con la X, clic fuera o Esc. Maneja loading/error propio.
- **`api.ts`**: `fetchFacturaDetalle(numero)` y `fetchOVDetalle(numero)`.
- **Disparo del modal**:
  - `App.tsx` (contabilidad) mantiene el estado `detalle` (`{tipo, numero} | null`) y renderiza `<DetalleModal>` cuando hay uno.
  - `FacturasTable`: `onClick` de fila → `onAbrirDetalle('factura', invoiceNumber)`. **La celda Cartera (editable) hace `stopPropagation`** para no abrir el modal al editar.
  - `OVPendientes`: `onClick` de fila → abre `<DetalleModal tipo="ov" numero={...}>` (la sección gestiona su propio estado de modal, ya que es autocontenida).

## 3. Alcance / fuera de alcance

- **En alcance:** 2 endpoints, modal reutilizable, clic-para-detalle en las dos tablas, manejo del conflicto con la celda Cartera.
- **Fuera:** logo/plantilla exacta de Zoho, imprimir/exportar el detalle (PDF), edición del detalle, cache del endpoint (los detalles son puntuales; se puede añadir `cached` luego).

## 4. Criterios de éxito

- Clic en una factura muestra sus líneas reales (SKU, descripción, uds, precio) y los totales cuadran con la fila (subtotal = TOTAL($), total = TOTAL+IVA).
- Clic en una OV pendiente muestra sus líneas y totales.
- Editar la celda Cartera NO abre el modal.
- Un nº inexistente → error controlado en el modal.

## 5. Riesgos

- `billing_address` puede venir con estructura/campos distintos; se compone defensivamente y, si sale pobre, se ajusta a `books.contacts`.
- Facturas/OV con muchas líneas → el modal hace scroll interno (no rompe el layout).
