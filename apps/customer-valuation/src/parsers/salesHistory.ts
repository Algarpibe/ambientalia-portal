/**
 * Parser para Ventas Históricas (formato wide -> formato canónico)
 * Convierte Excel con columnas por año a formato largo
 */

import * as XLSX from 'xlsx';
import { CustomerSalesYearRecord } from '../types';
import { normalizeClientName } from '../utils/normalize';
import { parseCurrency } from '../utils/parsing';

/**
 * Parsea un archivo Excel de ventas históricas en formato wide
 * Formato esperado: customer_name, 2015, 2016, ..., 2025
 */
export async function parseSalesHistory(file: File): Promise<CustomerSalesYearRecord[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  if (data.length === 0) {
    throw new Error('El archivo de ventas históricas está vacío');
  }

  const records: CustomerSalesYearRecord[] = [];

  // Detectar columnas de años (buscamos cualquier número de 4 dígitos entre 2000 y 2100)
  const allKeys = Object.keys(data[0]);
  const yearColumns = allKeys.filter(key => {
    const num = parseInt(key, 10);
    return !isNaN(num) && num >= 2000 && num <= 2100;
  });

  // Detectar columna de nombre del cliente (más flexible)
  const nameColumn = allKeys.find(key => {
    const lower = key.toLowerCase();
    return lower.includes('customer') || lower.includes('cliente') ||
      lower.includes('name') || lower.includes('nombre') ||
      lower === 'client' || lower === 'company' || lower === 'empresa' ||
      lower.includes('razón') || lower.includes('social');
  }) || allKeys[0];

  console.log('[SalesHistoryParser] Columnas detectadas:', { nameColumn, yearColumns });

  if (yearColumns.length === 0) {
    throw new Error(`No se encontraron columnas de años en el Excel (Columnas encontradas: ${allKeys.join(', ')})`);
  }

  // Unpivot: una fila por cliente/año
  for (const row of data) {
    const rawName = String(row[nameColumn] ?? '').trim();
    if (!rawName) continue;

    const normName = normalizeClientName(rawName);

    for (const yearCol of yearColumns) {
      const year = parseInt(yearCol, 10);
      const rawValue = row[yearCol];

      // Parsear valor numérico (puede venir como string con formato)
      let salesUsd = 0;
      if (typeof rawValue === 'number') {
        salesUsd = rawValue;
      } else if (typeof rawValue === 'string') {
        salesUsd = parseCurrency(rawValue);
      }

      records.push({
        customerNameRaw: rawName,
        customerNameNorm: normName,
        year,
        salesUsd: Math.max(0, salesUsd) // No permitir negativos
      });
    }
  }

  return records;
}

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
