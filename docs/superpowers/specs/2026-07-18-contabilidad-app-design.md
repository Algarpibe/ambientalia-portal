# Diseño — App `contabilidad` (Facturación 2026)

**Fecha:** 2026-07-18
**Objetivo:** Sustituir el Excel `Contabilidad_muestra.xlsx` (hoja *Fact 2026*) por una app dentro del portal Antigravity. Misma vista que el Excel, pero **viva** (se actualiza sola desde Zoho) y con **Cartera editable** en línea.

---

## 1. Alcance

- **Una sola vista**, fiel a la hoja `Fact 2026`: tabla de facturación arriba + bloque de resumen mensual/anual abajo.
- Los datos que Zoho tiene se toman **automáticos** (nunca se editan). Lo que Zoho no tiene se vuelve **editable** y se guarda en BD.
- **Fuera de alcance (YAGNI, por ahora):** pestañas adicionales, vista de aging/cartera separada, widgets de dashboard, exportación a Excel, edición del presupuesto por UI. Se pueden añadir después.

## 2. Modelo de datos: automático (Zoho) vs manual (BD)

### Automático desde Zoho (solo lectura, réplica Postgres vía hub-api)
Razón Social · Fecha factura · Fecha vencimiento · OV · Trato · Ticket · QT · Total ($) · IVA (19%) · Total + IVA · Cobrado (%) · Cobrado ($) · Por Cobrar ($) · Retenciones · % Participación · Nº factura

Mapeo a la réplica (`books.invoices` + joins), siguiendo `apps/hub-api/src/reconciliation.ts` + `mappers.ts`:

| Columna Excel | Origen |
|---|---|
| Razón Social | `books.invoices.customer_name` |
| Fecha factura | `books.invoices.date` |
| Fecha vencimiento | `books.invoices.due_date` |
| OV | `books.invoices.reference_number` |
| Total ($) | `books.invoices.total` |
| IVA (19%) | `books.invoices.raw ->> 'tax_total'` |
| Total + IVA | calculado (Total + IVA) |
| Cobrado ($) | `Total − balance` (balance = `raw ->> 'balance'` con fallback a `total`) |
| Por Cobrar ($) | `balance` |
| Cobrado (%) | calculado (`Cobrado / (Total+IVA)`) |
| Retenciones | campo de retención en `books.invoices.raw` (a confirmar la key exacta) |
| % Participación | calculado (Total+IVA de la factura / Total+IVA facturado del año) |
| Nº factura | `books.invoices.invoice_number` |
| Trato | `crm.deals` (left join, a confirmar la clave de enlace) |
| Ticket | `desk.tickets` (left join, a confirmar la clave de enlace) |
| QT | última cotización del trato en Zoho CRM (a confirmar el enlace) |

**Riesgo conocido:** Trato, Ticket y **QT** existen en Zoho pero enlazarlos por factura requiere una clave de join que hay que confirmar contra la réplica durante la implementación. Si para una factura no hay enlace fiable, ese campo se muestra vacío (no se inventa). No se convierten en editables en esta fase.

### Manual (editable, guardado en BD de usuarios — que sí es de escritura)
- **Cartera** — clasificación/nota de estado de cobro por factura. En la muestra está vacía. Editable en línea.

### Sembrado (constante, sin UI de edición por ahora)
- **Presupuesto (Pto 2026)** y comparativos, extraídos del Excel:
  - Pto 2026 (meta anual, sin IVA): **$4.416.000.000**
  - Facturación 2025 (comparativo): **$4.079.226.260**
  - Facturación 2024 (comparativo): **$2.423.070.754**

## 3. Bloque de resumen (parte inferior de la vista)

Calculado en vivo desde las facturas del año:
- **Facturación por mes** (Ene…Dic) y **Acumulado** del año.
- **IVA** por periodo.
- **TOTAL 2026**: total, IVA, total+IVA, cobrado, por cobrar, retenciones.
- **Cumplimiento vs Pto 2026** (% y diferencia) y comparativo vs 2024/2025.

Todas las filas mensuales son **reales** (agregadas de las facturas). El presupuesto/comparativos son las constantes sembradas.

## 4. Backend (hub-api)

Nuevo módulo `apps/hub-api/src/contabilidad/` siguiendo el patrón de `wo-sales/router.ts`:

- `GET /api/contabilidad/facturas` — `requireAuth` + `requireApp('contabilidad')`. Devuelve `{ facturas: FacturaRow[], resumen: {...}, budget: {...} }`. Envuelto en `cached()` (~120s) como los demás.
  - SQL sobre `books.invoices` (+ left joins a `crm.deals`, `desk.tickets`, cotización), fusionando el override de Cartera desde la tabla nueva.
  - Convención de la casa: los valores numéricos de `raw` se leen como texto (`raw ->> 'x'`) y se castean en TS, nunca `::numeric` en SQL.
- `PUT /api/contabilidad/cartera/:invoiceNumber` — `requireAuth` + `requireApp('contabilidad')`. Body `{ cartera: string }`. Upsert en la tabla de overrides.

### Tabla nueva (migración idempotente en `apps/hub-api/src/users/migrations/`)
```sql
CREATE TABLE IF NOT EXISTS contabilidad_overrides (
  invoice_number TEXT PRIMARY KEY,
  cartera        TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     INTEGER
);
```
El presupuesto/comparativos van como constante en el código del backend (o un pequeño JSON de config), no en BD.

## 5. Frontend (`apps/contabilidad/src/`)

Mismo patrón que WO-sales (React 19 + Vite + lucide-react, sin Tailwind propio — lo compila el portal):
- `package.json` (name `contabilidad`), `vite.config.ts` (plugin react + alias de `react`/`react-dom` a `../../node_modules`), `tsconfig.json`, `index.html`, `src/main.tsx`.
- `src/App.tsx` → `export default` de un componente **solo-cuerpo** (`<main className="flex-grow ... p-6 overflow-y-auto">`), sin router ni sidebar.
- Lee `import.meta.env.VITE_HUB_API_URL` y el token de `localStorage['ambientalia_token']` (`authHeaders()`), con `mensajeDeError(res)` en español para 401/403.
- Tabla densa estilo hoja de cálculo, moneda COP (`Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 })`), ordenable por encabezado, filtro por cliente/fecha.
- Celda **Cartera** editable (input/dropdown) que hace `PUT` y refresca en línea.
- Bloque de resumen mensual/anual debajo.

## 6. Integración al portal

1. `apps/portal/src/lib/apps.ts` → añadir `{ id: 'contabilidad', label: 'Contabilidad', route: '/contabilidad', category: 'aplicacion' }`.
2. `apps/portal/src/App.tsx` → import lazy (`lazyConReintento(() => import('../../contabilidad/src/App'))`) + `<Route path="/contabilidad/*" element={<AppGuard appId="contabilidad"><Contabilidad /></AppGuard>} />`.
3. `Dockerfile` (raíz) → `COPY apps/contabilidad/package*.json ./apps/contabilidad/` en la etapa de build (la lista es explícita, no glob).
4. Asignar la app al usuario desde el panel admin (escribe `user_apps` → JWT `apps[]`).

## 7. Criterios de éxito

- La app aparece en el portal para usuarios con la app asignada y carga las facturas 2026 desde Zoho sin subir ningún Excel.
- Las columnas y el orden coinciden con la hoja `Fact 2026`.
- El resumen mensual/acumulado y el % de cumplimiento vs Pto 2026 cuadran con el Excel para los meses ya facturados.
- Editar Cartera persiste (se mantiene tras recargar) y no afecta ningún dato de Zoho.
- Endpoint protegido: un usuario sin la app asignada recibe 403.

## 8. Riesgos / pendientes de confirmar en implementación

- Claves de join para **Trato / Ticket / QT** por factura (puede requerir inspeccionar `raw`).
- Key exacta de **Retenciones** e **IVA** dentro de `books.invoices.raw`.
- Definir el conjunto de valores de **Cartera** (¿lista fija: al día / en gestión / vencida / acuerdo? ¿o texto libre?) — decidir con el usuario antes de construir el editor.
