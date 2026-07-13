/**
 * Ventas Históricas — helpers de agrupación por cliente/año.
 * (El parser de Excel se retiró: la app carga del hub, sin subida de archivos.)
 */

import { CustomerSalesYearRecord } from '../types';

/**
 * Agrupa registros por cliente normalizado
 */
export function groupByCustomer(
  records: CustomerSalesYearRecord[]
): Map<string, Record<number, number>> {
  const map = new Map<string, Record<number, number>>();

  for (const rec of records) {
    if (!map.has(rec.customerNameNorm)) {
      map.set(rec.customerNameNorm, {});
    }
    const yearMap = map.get(rec.customerNameNorm)!;
    yearMap[rec.year] = (yearMap[rec.year] || 0) + rec.salesUsd;
  }

  return map;
}

/**
 * Obtiene lista de clientes únicos normalizados
 */
export function getUniqueCustomers(records: CustomerSalesYearRecord[]): string[] {
  const seen = new Set<string>();
  return records.filter(r => {
    if (seen.has(r.customerNameNorm)) return false;
    seen.add(r.customerNameNorm);
    return true;
  }).map(r => r.customerNameNorm);
}

/**
 * Obtiene el mapeo de nombre normalizado -> nombre raw
 */
export function getNormToRawMapping(
  records: CustomerSalesYearRecord[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const rec of records) {
    if (!map.has(rec.customerNameNorm)) {
      map.set(rec.customerNameNorm, rec.customerNameRaw);
    }
  }
  return map;
}
