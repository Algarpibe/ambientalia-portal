import type { WidgetDescriptor } from './types';

// Registro de factories de import dinámico, una por app que expone widgets.
// El import dinámico debe ser analizable estáticamente por Vite/Rollup para el
// chunk-splitting, por eso es un mapa explícito (no globbing).
//
// PILOTO (Fase 1): solo se registra `customer-profitability`, la única app con
// widgets reales implementados. Registrar un appId cuyo módulo `src/widgets/index`
// aún no existe rompería el build (import no resoluble). Cada app nueva se añade
// con una línea aquí cuando implemente su `src/widgets/index.ts`.

export type WidgetModule = { default: WidgetDescriptor[] };

export const WIDGET_FACTORIES: Record<string, () => Promise<WidgetModule>> = {
  'customer-profitability': () => import('../../../customer-profitability/src/widgets/index'),
  // Pendiente (tarea 9.4) — se activan al implementar sus widgets:
  // 'payment-reconciliation':  () => import('../../../payment-reconciliation/src/widgets/index'),
  // 'customer-valuation':      () => import('../../../customer-valuation/src/widgets/index'),
  // 'inventory-optimization':  () => import('../../../inventory-optimization/src/widgets/index'),
  // 'inventory-consolidation': () => import('../../../inventory-consolidation/src/widgets/index'),
  // 'product-sales':           () => import('../../../product-sales/src/widgets/index'),
  // 'laboratorios-ambientales':() => import('../../../laboratorios-ambientales/src/widgets/index'),
  // 'WO-sales':                () => import('../../../WO-sales/src/widgets/index'),
};
