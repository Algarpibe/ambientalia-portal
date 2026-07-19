import type { WidgetDescriptor } from './types';

// Registro de factories de import dinámico, una por app que expone widgets.
// El import dinámico debe ser analizable estáticamente por Vite/Rollup para el
// chunk-splitting, por eso es un mapa explícito (no globbing).
//
// Registrar un appId cuyo módulo `src/widgets/index` aún no existe rompería el
// build (import no resoluble). Cada app nueva se añade con una línea aquí cuando
// implemente su `src/widgets/index.ts`.
//
// Apps SIN widgets todavía (no tienen endpoint de datos en hub-api o son de
// acción, no de datos): inventory-consolidation, product-sales,
// laboratorios-ambientales, WO-sales.

export type WidgetModule = { default: WidgetDescriptor[] };

export const WIDGET_FACTORIES: Record<string, () => Promise<WidgetModule>> = {
  'customer-profitability': () => import('../../../customer-profitability/src/widgets/index'),
  'payment-reconciliation': () => import('../../../payment-reconciliation/src/widgets/index'),
  'customer-valuation': () => import('../../../customer-valuation/src/widgets/index'),
  'inventory-optimization': () => import('../../../inventory-optimization/src/widgets/index'),
  'contabilidad': () => import('../../../contabilidad/src/widgets/index'),
};
