// Lógica pura de la tabla de resultados (ARQ-001 tarea A): EOQ, predicado de
// urgencia, filtrado por pestaña, filtrado por controles, orden y derivación de
// listas (fabricantes/categorías). Se extrajo de ResultTable sin cambiar la
// lógica, para testearla aislada (el EOQ es un cálculo financiero).
import type { AnalysisResult } from '../types';

// El EOQ se movió a ./eoq para que lo compartan la tabla y el motor de cálculo sin
// que importarlo aquí arrastre el motor al bundle. Se re-exporta para no romper a
// los consumidores (ResultTable, resultTableExport, tests).
export { computeEoq } from './eoq';

// Un ítem es "urgente" (hay que pedir ya) si el pedido sugerido es > 0 y hay
// señal de umbral/negativo. Se usaba duplicado en 3 sitios del componente.
export function isUrgentItem(item: AnalysisResult): boolean {
  // Los artículos inactivos en Zoho (dados de baja/sustituidos) no se piden.
  if (item.itemStatus === 'inactive') return false;
  // El umbral es el mayor entre el PdP calculado y el nivel del ERP. El nivel puede
  // venir sin configurar (null) o ser -1 ("bajo demanda"); ninguno de los dos es un
  // umbral, así que cuentan como 0 y manda el PdP.
  const threshold = Math.max(item.reorderPoint, Math.max(item.erpLevel ?? 0, 0));
  const suggestedOrder = Math.max(
    0,
    Math.round(threshold + item.optimalQuantity - (item.availableQuantity + item.orderedQuantity)),
  );
  return (
    suggestedOrder > 0 &&
    (threshold > 0 || item.availableQuantity < 0) &&
    (item.availableQuantity < 0 || item.availableQuantity + item.orderedQuantity <= threshold)
  );
}

/** Filtra por la pestaña activa (inventario/main/servicio/urgente). */
export function filterByTab(data: AnalysisResult[], activeTab: string): AnalysisResult[] {
  return data.filter((item) => {
    if (activeTab === 'current_inventory') return true;
    if (activeTab === 'main') return !item.isService;
    if (activeTab === 'service') return item.isService;
    if (activeTab === 'urgent') return isUrgentItem(item);
    return true;
  });
}

export interface ResultFilters {
  filter: string; // término de búsqueda (sku/nombre/categoría)
  statusFilter: string;
  manufacturerFilter: string;
  categoryFilter: string;
  onlyCommitted: boolean;
  variabilityFilter: string;
  demandTypeFilter: string;
  valueTypeFilter: string;
  trackingFilter: string; // 'all' | 'tracked' | 'untracked'
  abcBasis: string; // 'cost' | 'revenue'
  abcFilter: string;
  xyzFilter: string;
  patternFilter: string;
}

/** Aplica los controles de filtro sobre la data ya filtrada por pestaña. */
export function filterResults(data: AnalysisResult[], activeTab: string, f: ResultFilters): AnalysisResult[] {
  return data.filter((item) => {
    const term = f.filter.toLowerCase();
    const matchesSearch =
      item.sku.toLowerCase().includes(term) ||
      item.itemName.toLowerCase().includes(term) ||
      item.category.toLowerCase().includes(term);
    // En Análisis Principal / Sin Seguimiento el estatus es la recomendación de
    // nivel ERP (levelStatus); en el resto, el estatus operativo (status).
    const statusField = activeTab === 'main' || activeTab === 'service' ? item.levelStatus : item.status;
    const matchesStatus = activeTab === 'urgent' || f.statusFilter === 'all' || statusField === f.statusFilter;
    const matchesManufacturer = f.manufacturerFilter === 'all' || item.manufacturer === f.manufacturerFilter;
    const matchesCategory = f.categoryFilter === 'all' || item.category === f.categoryFilter;
    const matchesCommitted = activeTab !== 'urgent' || !f.onlyCommitted || item.committedQuantity > 0;
    const matchesVariability = f.variabilityFilter === 'all' || item.variabilityClass === f.variabilityFilter;
    const matchesDemandType = f.demandTypeFilter === 'all' || item.demandType === f.demandTypeFilter;
    const matchesValueType = f.valueTypeFilter === 'all' || item.valueClass === f.valueTypeFilter;
    // "Seguimiento" = el artículo hace seguimiento de inventario en el ERP
    // (track_inventory de Zoho, que es isService invertido). Antes se usaba
    // currentLevel !== -1 como proxy, que ya era erróneo (el -1 no dice nada del
    // seguimiento) y ahora directamente miente: un -1 es "bajo demanda", un
    // artículo con seguimiento y decisión tomada.
    const matchesTracking =
      f.trackingFilter === 'all' ||
      (f.trackingFilter === 'tracked' && !item.isService) ||
      (f.trackingFilter === 'untracked' && item.isService);
    const itemAbc = f.abcBasis === 'cost' ? item.abcClass : item.abcClassRevenue;
    const matchesAbc = f.abcFilter === 'all' || itemAbc === f.abcFilter;
    const matchesXyz = f.xyzFilter === 'all' || item.xyzClass === f.xyzFilter;
    const matchesPattern = f.patternFilter === 'all' || item.demandPattern === f.patternFilter;
    return (
      matchesSearch && matchesStatus && matchesManufacturer && matchesCategory && matchesCommitted &&
      matchesVariability && matchesDemandType && matchesValueType && matchesTracking &&
      matchesAbc && matchesXyz && matchesPattern
    );
  });
}

/** Ordena por el campo dado (booleano/string/numérico), sin mutar la entrada. */
export function sortResults(
  data: AnalysisResult[],
  sortField: keyof AnalysisResult,
  sortDirection: 'asc' | 'desc',
): AnalysisResult[] {
  return [...data].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];
    if (typeof aValue === 'boolean') {
      return sortDirection === 'asc'
        ? aValue === bValue ? 0 : aValue ? 1 : -1
        : aValue === bValue ? 0 : aValue ? -1 : 1;
    }
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((aValue as any) < (bValue as any)) return sortDirection === 'asc' ? -1 : 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((aValue as any) > (bValue as any)) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}

/** Fabricantes únicos (ordenados) presentes en la data de la pestaña activa. */
export function uniqueManufacturers(data: AnalysisResult[], activeTab: string): string[] {
  return Array.from(new Set(filterByTab(data, activeTab).map((r) => r.manufacturer))).sort();
}

/** Categorías únicas (ordenadas) presentes en la data de la pestaña activa. */
export function uniqueCategories(data: AnalysisResult[], activeTab: string): string[] {
  return Array.from(new Set(filterByTab(data, activeTab).map((r) => r.category))).sort();
}
