/**
 * Las apps del portal que pueden salir en un correo de acceso: el nombre y la
 * ruta de cada id de portal.user_apps.
 *
 * Es una COPIA de apps/portal/src/lib/apps.ts (la fuente de verdad), en el
 * mismo orden. hub-api no puede importar el portal: su Dockerfile solo copia
 * apps/hub-api, y un paquete compartido obligaría a cambiarlo. Para que la copia
 * no se quede atrás, app-catalog.test.ts lee el fichero del portal y falla si
 * ids, nombres o rutas no coinciden: quien añada o renombre una app en el
 * portal, que la cambie también aquí.
 */

export interface AccessApp {
  label: string;
  route: string;
}

export const ACCESS_APPS: Readonly<Record<string, AccessApp>> = {
  'payment-reconciliation': { label: 'Conciliador de Pagos', route: '/conciliador-pagos' },
  'inventory-optimization': { label: 'Análisis de Inventario', route: '/analisis-inventario' },
  'inventory-consolidation': { label: 'Consolidador de Inventario', route: '/consolidador-inventario' },
  'laboratorios-ambientales': { label: 'Laboratorios Ambientales', route: '/laboratorios-ambientales' },
  'customer-valuation': { label: 'Valoración de Clientes', route: '/valoracion-clientes' },
  'WO-sales': { label: 'Carga de Pedidos WO', route: '/carga-pedidos-wo' },
  contabilidad: { label: 'Contabilidad', route: '/contabilidad' },
  'ov-pendientes': { label: 'OV pendientes de facturar', route: '/ov-pendientes' },
  ausencias: { label: 'Vacaciones y Permisos', route: '/ausencias' },
  calibraciones: { label: 'Calibraciones', route: '/calibraciones' },
  'trazabilidad-mantenimientos': { label: 'Trazabilidad Mantenimientos Clientes', route: '/trazabilidad-mantenimientos' },
  'equipos-taller': { label: 'Equipos en taller', route: '/equipos-taller' },
};

/**
 * Las apps conocidas de `ids`, en el orden del catálogo y sin repetir. Un id que
 * no está en el catálogo se omite: el correo no puede nombrar ni enlazar una app
 * que no sabe cuál es.
 */
export function knownApps(ids: readonly string[]): AccessApp[] {
  const pedidas = new Set(ids);
  return Object.entries(ACCESS_APPS)
    .filter(([id]) => pedidas.has(id))
    .map(([, app]) => app);
}
