// Catálogo de aplicaciones del portal — fuente única de verdad para:
//  - el modal de asignación de apps (AppAssignModal),
//  - el guard de ruta por app (AppGuard, tarea 17.1),
//  - el filtrado del Sidebar (tarea 16.1).
// El `id` es el identificador que se persiste en user_apps y viaja en el JWT
// (coincide con el nombre de la sub-app en el monorepo). `route` es la ruta en
// el router del portal.

export type AppCategory = 'herramienta' | 'aplicacion';

export interface AppInfo {
  id: string;
  label: string;
  route: string;
  category: AppCategory;
}

export const APPS: AppInfo[] = [
  { id: 'payment-reconciliation', label: 'Conciliador de Pagos', route: '/conciliador-pagos', category: 'aplicacion' },
  { id: 'customer-profitability', label: 'Rentabilidad de Clientes', route: '/rentabilidad-clientes', category: 'aplicacion' },
  { id: 'inventory-optimization', label: 'Análisis de Inventario', route: '/analisis-inventario', category: 'aplicacion' },
  { id: 'inventory-consolidation', label: 'Consolidador de Inventario', route: '/consolidador-inventario', category: 'herramienta' },
  { id: 'product-sales', label: 'Ventas por Artículos', route: '/ventas-articulos', category: 'herramienta' },
  { id: 'laboratorios-ambientales', label: 'Laboratorios Ambientales', route: '/laboratorios-ambientales', category: 'aplicacion' },
  { id: 'customer-valuation', label: 'Valoración de Clientes', route: '/valoracion-clientes', category: 'aplicacion' },
  { id: 'WO-sales', label: 'Carga de Pedidos WO', route: '/carga-pedidos-wo', category: 'aplicacion' },
  { id: 'contabilidad', label: 'Contabilidad', route: '/contabilidad', category: 'aplicacion' },
  { id: 'ausencias', label: 'Vacaciones y Permisos', route: '/ausencias', category: 'aplicacion' },
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

/** True si el usuario tiene al menos una app asignada de la categoría dada. */
export function hasAssignedInCategory(category: AppCategory, assignedIds: string[]): boolean {
  return APPS.some((a) => a.category === category && assignedIds.includes(a.id));
}
