// Catálogo de aplicaciones del portal — fuente única de verdad para:
//  - el modal de asignación de apps (AppAssignModal),
//  - el guard de ruta por app (AppGuard, tarea 17.1),
//  - el filtrado del Sidebar (tarea 16.1).
// El `id` es el identificador que se persiste en user_apps y viaja en el JWT
// (coincide con el nombre de la sub-app en el monorepo). `route` es la ruta en
// el router del portal.

export interface AppInfo {
  id: string;
  label: string;
  route: string;
}

export const APPS: AppInfo[] = [
  { id: 'payment-reconciliation', label: 'Conciliador de Pagos', route: '/conciliador-pagos' },
  { id: 'customer-profitability', label: 'Rentabilidad de Clientes', route: '/rentabilidad-clientes' },
  { id: 'inventory-optimization', label: 'Análisis de Inventario', route: '/analisis-inventario' },
  { id: 'inventory-consolidation', label: 'Consolidador de Inventario', route: '/consolidador-inventario' },
  { id: 'product-sales', label: 'Ventas por Artículos', route: '/ventas-articulos' },
  { id: 'laboratorios-ambientales', label: 'Laboratorios Ambientales', route: '/laboratorios-ambientales' },
  { id: 'customer-valuation', label: 'Valoración de Clientes', route: '/valoracion-clientes' },
];

/** Devuelve la info de una app por su id. */
export function getApp(id: string): AppInfo | undefined {
  return APPS.find((a) => a.id === id);
}

/** Devuelve la info de una app por su ruta (p.ej. '/conciliador-pagos'). */
export function getAppByRoute(route: string): AppInfo | undefined {
  return APPS.find((a) => a.route === route);
}

/** True si `route` corresponde a una app asignada (está en `assignedIds`). */
export function isRouteAssigned(route: string, assignedIds: string[]): boolean {
  const info = getAppByRoute(route);
  return info ? assignedIds.includes(info.id) : false;
}
