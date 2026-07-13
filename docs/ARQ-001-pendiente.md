# ARQ-001 — descomposición de componentes-dios: pendiente

Estado de la descomposición de los componentes grandes (hallazgo ARQ-001 de la
auditoría). **Todo lo pendiente es JSX presencial grande**: valor mayormente
solo-LOC, test de render superficial y riesgo real de romper JSX intrincado —
por eso se difirió. **No queda lógica pura extraíble de valor** (ya está toda
extraída y testeada).

## Hecho ✅

- **Lógica pura** extraída a módulos testeables (sin cambiar comportamiento):
  - `payment-reconciliation/src/metrics/generalAnalysisMetrics.ts` (KPIs: DSO,
    recovery, variación, mora, retención, top clientes, filtros/orden) — 20 tests.
  - `inventory-optimization/src/utils/resultTableLogic.ts` (EOQ, `isUrgentItem`,
    filtrado por pestaña/controles, orden, fabricantes/categorías) — 20 tests.
  - `inventory-optimization/src/utils/resultTableExport.ts` (export xlsx/CSV).
  - `customer-valuation/src/metrics/clientListHelpers.ts` (`filterClients`,
    `uniqueClientNames`, `rankClients`) — 13 tests.
- **Subcomponentes JSX** extraídos con tests de render:
  - `inventory-optimization/src/components/SortableColumnItem.tsx` (+3 tests).
  - `inventory-optimization/src/components/SortableColumnList.tsx` (DRY de los 2
    popovers de columnas) (+2 tests).
  - `payment-reconciliation/src/components/InfoTooltip.tsx` (usado 9×) (+3 tests).
- **Splits mecánicos**: `customer-valuation/src/ui/{StatsCard,ExportButton,RankingTable}.tsx`.
- **Infra de tests de UI**: jsdom + React Testing Library en inventory y
  reconciliation (`vitest.config.ts` + `src/test/setup.ts`). De paso se añadió el
  script `test` a payment-reconciliation (sus tests no corrían en CI).

## Pendiente (diferido) — solo JSX grande

Hacerlo **con el navegador abierto** para validar renders; no a ciegas.

### `inventory-optimization/src/components/ResultTable.tsx` (~1134 LOC)
- **Mega-tabla**: el `<table>` principal (~250 líneas) con renderers de celda
  especiales (status/badges, EOQ, formatos moneda, colores ABC-XYZ, resize de
  columnas). Prop surface ~10.
- **Barra de filtros + tabs**: bloque grande de controles acoplado a mucho estado.
- **Tabla de historial**: sección secundaria con su propia tabla.

### `payment-reconciliation/src/GeneralAnalysis.tsx` (~1125 LOC)
- **KpiCard**: las tarjetas KPI varían demasiado (colores hardcodeados,
  coloreado condicional en "Variación") para un componente genérico limpio.
- **Panel de filtros** (`showFilterPanel`): rangos DPD/on-time/monto/estado.
- **Panel de config de columnas**: reordenamiento por drag-drop nativo.
- **Tabla de métricas**: tabla de clientes con columnas configurables.

### `customer-valuation` — prácticamente terminado
- `App.tsx` (~454 LOC) y `RankingTable.tsx` (~150 LOC) están en buena forma.
- Único resto de bajo valor: el dispatcher `clients` (elige `aggregateClients`
  vs `aggregateClientsExtended`) se dejó inline por estar acoplado a las
  agregaciones, ya cubiertas por `scoring.test`.

## Orden sugerido si se retoma
1. **Panel de filtros de GeneralAnalysis** — el más autocontenido de lo que queda.
2. Panel de columnas / KpiCard de GeneralAnalysis.
3. Barra de filtros de ResultTable.
4. **Mega-tablas** (ResultTable y GeneralAnalysis) al final — las de mayor churn
   y menor valor; extraer verbatim a un `<*DataTable>` con test de render básico.

## Relacionado (fuera de ARQ-001)
- **ARQ-004**: desacoplar el portal del *source* de cada sub-app (publicar como
  paquetes o aislar builds) — cambio arquitectónico mayor, hallazgo aparte.
