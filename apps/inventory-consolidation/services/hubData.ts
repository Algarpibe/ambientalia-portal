import type { RawRowData } from '../types';

// "Generar desde la base de datos": los mismos tres listados que se exportan de Zoho
// (Resumen de inventario + Comprometido FACT + Comprometido ENV), servidos por hub-api
// desde la réplica. Se traducen a filas con los MISMOS nombres de columna que traen
// los archivos, para que processInventoryData() los procese sin cambiar una sola
// fórmula: el camino de archivos y el de la base generan el mismo xlsx.

export interface HubComprometido {
  sku: string;
  item_name: string;
  quantity: number;
  transaction: string;
}

export interface HubConsolidacion {
  inventory: { sku: string; item_name: string; quantity_available: number }[];
  fact: HubComprometido[];
  env: HubComprometido[];
  generatedAt: string;
}

// Columnas tal como vienen en "Detalles de existencias comprometidas" de Zoho.
const aFilaComprometida = (r: HubComprometido): RawRowData => ({
  sku: r.sku,
  'Nombre del artículo': r.item_name,
  'Existencias comprometidas': r.quantity,
  'Transacción#': r.transaction,
});

/** Respuesta del hub → las tres listas de filas que consume processInventoryData. */
export function hubARawRows(d: HubConsolidacion): { invData: RawRowData[]; factData: RawRowData[]; envData: RawRowData[] } {
  return {
    // Columnas tal como vienen en el "Resumen de inventario" de Zoho.
    invData: d.inventory.map((r) => ({ sku: r.sku, item_name: r.item_name, quantity_available: r.quantity_available })),
    factData: d.fact.map(aFilaComprometida),
    envData: d.env.map(aFilaComprometida),
  };
}

interface CargarOpts {
  apiBase: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}

/** Pide los tres listados al hub (GET /api/inventory-consolidation/data). */
export async function cargarDesdeHub({ apiBase, headers, fetchImpl = fetch }: CargarOpts): Promise<HubConsolidacion> {
  if (!apiBase) throw new Error('Configuración incompleta: falta VITE_HUB_API_URL');
  const res = await fetchImpl(`${apiBase}/api/inventory-consolidation/data`, { headers });
  if (!res.ok) throw new Error(`El servidor respondió HTTP ${res.status}`);
  const d = await res.json();
  if (!['inventory', 'fact', 'env'].every((k) => Array.isArray(d?.[k]))) {
    throw new Error('Respuesta del hub con formato inesperado');
  }
  return d as HubConsolidacion;
}

/** Resumen_Inventario_<ddmmyy>_Desglosado.xlsx con la fecha dada (hoy por defecto). */
export function nombreArchivoDesglosado(fecha: Date = new Date()): string {
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const yy = String(fecha.getFullYear()).slice(-2);
  return `Resumen_Inventario_${dd}${mm}${yy}_Desglosado.xlsx`;
}
