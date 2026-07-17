// Agregación de inventario — funciones puras reutilizables por los widgets del
// Dashboard del Portal. Reusa el MISMO motor de análisis que la app
// (processInventoryData de utils/calculations) para no reinventar la ciencia de
// inventario ni inventar campos: el resultado y sus estados son idénticos a los
// que muestra la pantalla de "Análisis de Inventario".

import { processInventoryData } from '../utils/calculations';
import type { AnalysisResult } from '../types';
import type { InventoryData } from './useInventoryData';

export interface RiskItem {
  sku: string;
  itemName: string;
  status: AnalysisResult['status']; // 'Urgente' | 'Pedir'
  position: number;                 // disponible contable actual
  reorderPoint: number;             // punto de pedido calculado (redondeado)
  shortfall: number;                // unidades por debajo del punto de pedido
  coverageFraction: number;         // position / reorderPoint, acotado a [0, 1]
}

export interface InventorySummary {
  totalSkus: number;       // artículos analizados
  urgentCount: number;     // 'Urgente' — sin stock y nada en camino
  reorderCount: number;    // 'Pedir' — bajo el punto de pedido, sin cubrir
  atRiskCount: number;     // urgentCount + reorderCount
  inTransitCount: number;  // 'EnCamino' — faltante ya cubierto por lo pedido
  overstockCount: number;  // 'Overstock' — exceso sobre el techo sano
  inventoryValue: number;  // capital total en inventario (USD): Σ físico × costo
  atRisk: RiskItem[];      // artículos en riesgo, del más crítico al menos
}

// Parámetros EOQ por defecto (los mismos que usa la app si no se tocan los sliders).
const EOQ_DEFAULT_ORDER_COST = 100;
const EOQ_DEFAULT_HOLDING_RATE = 25;

/** Calcula el resumen de inventario a partir de los datos crudos del hub. */
export function analyze(data: InventoryData): InventorySummary {
  const empty: InventorySummary = {
    totalSkus: 0,
    urgentCount: 0,
    reorderCount: 0,
    atRiskCount: 0,
    inTransitCount: 0,
    overstockCount: 0,
    inventoryValue: 0,
    atRisk: [],
  };

  const results: AnalysisResult[] = processInventoryData(
    data.sales2026,
    data.sales2025,
    data.sales2024,
    data.sales2023,
    data.inventory,
    data.leadTime,
    EOQ_DEFAULT_ORDER_COST,
    EOQ_DEFAULT_HOLDING_RATE,
  );

  if (results.length === 0) return empty;

  let urgentCount = 0;
  let reorderCount = 0;
  let inTransitCount = 0;
  let overstockCount = 0;
  let inventoryValue = 0;
  const atRisk: RiskItem[] = [];

  for (const r of results) {
    inventoryValue += r.inventoryValue || 0;

    if (r.status === 'Urgente') urgentCount++;
    else if (r.status === 'Pedir') reorderCount++;
    else if (r.status === 'EnCamino') inTransitCount++;
    else if (r.status === 'Overstock') overstockCount++;

    if (r.status === 'Urgente' || r.status === 'Pedir') {
      const rop = Math.round(r.reorderPoint);
      const position = Math.round(r.availableQuantity);
      atRisk.push({
        sku: r.sku,
        itemName: r.itemName,
        status: r.status,
        position,
        reorderPoint: rop,
        shortfall: Math.max(0, rop - position),
        coverageFraction: rop > 0 ? Math.min(1, Math.max(0, position / rop)) : 0,
      });
    }
  }

  // Del más crítico al menos: primero los 'Urgente', luego por menor cobertura.
  atRisk.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'Urgente' ? -1 : 1;
    return a.coverageFraction - b.coverageFraction;
  });

  return {
    totalSkus: results.length,
    urgentCount,
    reorderCount,
    atRiskCount: urgentCount + reorderCount,
    inTransitCount,
    overstockCount,
    inventoryValue,
    atRisk,
  };
}

// ─── Formateo compartido ─────────────────────────────────────────────────────

/** Formato de moneda es-CO en COP, sin decimales (helper del contrato de widgets). */
export const formatMoney = (value: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0);

/**
 * Formato de moneda en USD, sin decimales. Los costos y valores de inventario de
 * esta app están en USD (igual que en toda la pantalla de análisis), así que el
 * valor de inventario se muestra en USD para no falsear la divisa.
 */
export const formatUsd = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);

/** Formato de número entero con separadores de miles (es-CO). */
export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value || 0);
