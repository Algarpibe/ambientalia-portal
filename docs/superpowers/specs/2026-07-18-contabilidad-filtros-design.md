# Diseño — Contabilidad: filtros + presupuesto configurable por año

**Fecha:** 2026-07-18
**Base:** amplía la app `contabilidad` ya desplegada (facturación viva desde Zoho + Cartera editable). Ver [2026-07-18-contabilidad-app-design.md](2026-07-18-contabilidad-app-design.md).

## Objetivo

Convertir la tabla en una herramienta de gestión, no solo una réplica del Excel: filtros (año, cliente, estado de cobro, mes), totales de la vista filtrada, y presupuesto editable por año (para que el cumplimiento funcione en cualquier año).

## Decisiones tomadas (brainstorming)

- Filtros: **Año, Cliente, Estado de cobro, Mes** (+ se mantiene el buscador de texto actual). Todos combinan en AND.
- **Año** cambia todo (tabla + resumen + presupuesto) y recarga del backend. El resto son filtros de cliente (solo tabla).
- **Presupuesto configurable por año**, guardado en BD, **editable solo por admin**, inline en el bloque de resumen.
- Cliente/estado/mes actúan sobre **tabla + una fila de totales de la vista**; el resumen mensual/presupuesto sigue siendo la panorámica del año.

## 1. Filtros (frontend)

Barra encima de la tabla. Todos se combinan en AND, junto con el buscador de texto existente.

| Filtro | Origen de opciones | Semántica |
|---|---|---|
| **Año** | `añosDisponibles` del backend | Recarga `GET /…/facturas?year=YYYY`. Por defecto 2026. |
| **Cliente** | razones sociales distintas de los datos cargados | `razonSocial === elegido` |
| **Estado de cobro** | fijo: Todas / Pagada / Con saldo / Vencida | Pagada = `porCobrar === 0`; Vencida = `porCobrar > 0 && fechaVencimiento < hoy`; Con saldo = `porCobrar > 0 && fechaVencimiento >= hoy` |
| **Mes** | fijo: Todos / Ene…Dic | mes de `fechaFactura` == elegido |

`hoy` se calcula en el cliente. Estado de cobro y mes son puramente frontend (no tocan backend).

## 2. Año → backend

- Endpoint: `GET /api/contabilidad/facturas?year=YYYY`. `year` opcional (default 2026), validado como entero 4 dígitos en rango razonable (p.ej. 2000–2100); inválido → 400.
- El `ANIO` constante de `source.ts` pasa a ser el parámetro; el rango de fechas se deriva de `year`.
- La respuesta añade:
  - `añosDisponibles: number[]` — años con al menos una factura (no interna), para el selector.
  - `facturadoPorAnio: Record<number, number>` — subtotal facturado por año (para los comparativos del resumen, ahora **calculados de datos** en vez de constantes).
- Ambos salen de una consulta agregada: `SELECT date_part('year', date)::int AS anio, SUM(sub_total) AS facturado FROM books.invoices WHERE <no AMI/OVI> GROUP BY 1`.

## 3. Presupuesto configurable (editable, solo admin)

- **Migración `008_contabilidad_budget.sql`**: tabla `portal.contabilidad_budget(year INT PK, presupuesto NUMERIC NOT NULL, updated_at TIMESTAMPTZ, updated_by UUID)`, sembrada con `INSERT ... (2026, 4416000000) ON CONFLICT DO NOTHING`.
- El resumen del año elegido lee su presupuesto de esa tabla:
  - hay presupuesto → `cumplimiento = facturadoSinIva / presupuesto`.
  - no hay → el bloque muestra "sin presupuesto configurado" (sin % de cumplimiento).
- Endpoint `PUT /api/contabilidad/budget/:year` — `requireAuth` + **`requireAdmin`**. Body `{ presupuesto: number }` (>= 0). Upsert por año. Invalida el cache con `clearCacheKey`.
- **Comparativos**: el resumen muestra el facturado de años anteriores tomándolos de `facturadoPorAnio` (calculado). Riesgo aceptado: si la réplica no tiene facturas completas de años viejos, el comparativo saldrá menor que en el Excel; se muestra tal cual (dato de la réplica).

## 4. Totales de la vista filtrada (frontend)

Fila/tarjeta bajo la tabla que reacciona a TODOS los filtros de tabla (cliente/estado/mes/texto):
- **Nº de facturas**, **Total ($)**, **Cobrado ($)**, **Por cobrar ($)** de las filas visibles.
- Se calcula en el cliente sobre el array ya filtrado.

## 5. Edición inline del presupuesto (frontend)

- En el bloque de resumen, la tarjeta "Presupuesto {año}" es editable **solo si `useAuth().role === 'admin'`**; si no, es de solo lectura.
- Al guardar: `PUT /api/contabilidad/budget/:year`, actualización optimista con rollback (mismo patrón que Cartera). Tras guardar, refrescar el cumplimiento.

## 6. Contrato de respuesta (ampliado)

```ts
interface ContabilidadData {
  facturas: FacturaContable[];        // sin cambios
  resumen: Resumen;                   // + presupuesto nullable, + comparativos por año
  anioActual: number;                 // el año consultado
  añosDisponibles: number[];
}
interface Resumen {
  meses: ResumenMes[];
  totalFacturadoSinIva: number;
  totalIva: number;
  presupuesto: number | null;         // del año consultado (era presupuesto2026)
  cumplimientoPct: number | null;     // null si no hay presupuesto
  comparativos: { anio: number; facturado: number }[]; // años anteriores con datos
}
```

Cambia el contrato respecto de hoy (`presupuesto2026`/`facturacion2025`/`facturacion2024` → `presupuesto`/`comparativos`). El frontend (`api.ts`, `ResumenMensual.tsx`) se actualiza en consecuencia.

## 7. Alcance / fuera de alcance

- **En alcance:** los 4 filtros, totales de la vista, presupuesto editable por año (admin), año multi-año, comparativos calculados.
- **Fuera (por ahora):** rango de fechas libre (solo "Mes"); aging con colores por días vencidos (el estado "Vencida" ya cubre lo esencial); exportar a Excel; sombreado de filas "facturables" (idea aparte en el backlog).

## 8. Criterios de éxito

- Elegir un año recarga tabla + resumen de ese año; el selector solo ofrece años con datos.
- Cliente/estado/mes filtran la tabla y la fila de totales cuadra con lo visible.
- "Vencida" marca facturas con saldo y vencimiento pasado.
- Un admin edita el presupuesto de un año y persiste; un no-admin no ve el control de edición y el `PUT` le responde 403.
- 2026 mantiene su presupuesto sembrado (4.416.000.000) y el cumplimiento coincide con el actual.

## 9. Riesgos

- Comparativos de años viejos pueden diferir del Excel si la réplica no tiene esas facturas completas.
- Cambio de contrato de `Resumen`: hay que actualizar backend (`domain.ts`, `source.ts`), sus tests, y el frontend (`api.ts`, `ResumenMensual.tsx`) de forma coordinada.
- Requiere que el usuario editor sea `admin` (rol en `portal.users`).
