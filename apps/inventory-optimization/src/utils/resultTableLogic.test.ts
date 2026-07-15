import { describe, it, expect } from 'vitest';
import type { AnalysisResult } from '../types';
import {
  computeEoq, isUrgentItem, filterByTab, filterResults, sortResults,
  uniqueManufacturers, uniqueCategories, type ResultFilters,
} from './resultTableLogic';

// Fábrica con defaults; se sobreescribe lo relevante por test.
function item(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    sku: 'SKU1', itemName: 'Item', currentLevel: 10, leadTimeDays: 30, leadTimeMonths: 1,
    leadTimeStdDays: 5, leadTimeSource: 'x', safetyStock: 5, reorderPoint: 10,
    optimalQuantity: 20, deviation: 0, status: 'Pedir', levelStatus: 'OK', itemStatus: 'active', coverageDays: 30, coverageRisk: false,
    orderDate: '', etaDate: '', etaDays: 0, unitCost: 10, annualValue: 100, annualValueRevenue: 120,
    coefVariation: 0.2, abcClass: 'A', xyzClass: 'X', abcXyz: 'AX', abcClassRevenue: 'A',
    abcXyzRevenue: 'AX', demandPattern: 'Suave', adi: 1, cv2: 0.1, crostonForecast: 0,
    monthsSinceLastSale: 0, deadStockClass: 'Activo', deadStockValue: 0, overstockUnits: 0,
    overstockValue: 0, inventoryValue: 0, monthlyAverage: 5, annualSales: 60, stdDev: 1,
    demandSource: 'Ventas 2026', manualReview: false, variabilityRatio: 1, category: 'Cat',
    isService: false, unitPrice: 15, orderedQuantity: 0, handQuantity: 10, physicalHandQuantity: 10,
    committedQuantity: 0, availableQuantity: 100, manufacturer: 'Fab', vendor: 'Prov', erpLevel: 8,
    variabilityClass: 'Media', demandType: 'Normal', valueClass: 'Estándar', history: {},
    ...over,
  };
}

const allFilters: ResultFilters = {
  filter: '', statusFilter: 'all', manufacturerFilter: 'all', categoryFilter: 'all',
  onlyCommitted: false, variabilityFilter: 'all', demandTypeFilter: 'all', valueTypeFilter: 'all',
  trackingFilter: 'all', abcBasis: 'cost', abcFilter: 'all', xyzFilter: 'all', patternFilter: 'all',
};

describe('computeEoq', () => {
  it('EOQ = √(2·D·S / H) con H = tasa·costo', () => {
    // D=1000, S=50, costo=10, tasa=20% → H=2 → √(2·1000·50/2)=√50000≈224
    expect(computeEoq(1000, 10, 50, 20)).toBe(224);
  });
  it('0 si no hay demanda', () => expect(computeEoq(0, 10, 50, 20)).toBe(0));
  it('0 si no hay costo de pedido', () => expect(computeEoq(1000, 10, 0, 20)).toBe(0));
  it('0 si la tasa de mantenimiento es 0 (H=0)', () => expect(computeEoq(1000, 10, 50, 0)).toBe(0));
  it('mínimo 1 cuando el resultado redondea por debajo', () => {
    expect(computeEoq(1, 100, 1, 100)).toBe(1);
  });
});

describe('isUrgentItem', () => {
  it('urgente cuando el pedido sugerido > 0 y disponible ≤ umbral', () => {
    expect(isUrgentItem(item({ reorderPoint: 50, erpLevel: 0, optimalQuantity: 20, availableQuantity: 5, orderedQuantity: 0 }))).toBe(true);
  });
  it('no urgente cuando hay disponible de sobra', () => {
    expect(isUrgentItem(item({ reorderPoint: 10, erpLevel: 0, optimalQuantity: 20, availableQuantity: 100, orderedQuantity: 0 }))).toBe(false);
  });
  it('urgente por disponible negativo aunque el umbral sea 0', () => {
    expect(isUrgentItem(item({ reorderPoint: 0, erpLevel: 0, optimalQuantity: 5, availableQuantity: -3, orderedQuantity: 0 }))).toBe(true);
  });
  it('un artículo inactivo nunca es urgente (aunque cumpla el umbral)', () => {
    expect(
      isUrgentItem(item({ itemStatus: 'inactive', reorderPoint: 50, erpLevel: 0, optimalQuantity: 20, availableQuantity: 5, orderedQuantity: 0 })),
    ).toBe(false);
  });
});

describe('filterByTab', () => {
  const data = [
    item({ sku: 'A', isService: false }),
    item({ sku: 'B', isService: true }),
    item({ sku: 'C', isService: false, reorderPoint: 50, availableQuantity: 5, optimalQuantity: 20 }), // urgente
  ];
  it('main → excluye servicios', () => {
    expect(filterByTab(data, 'main').map((i) => i.sku)).toEqual(['A', 'C']);
  });
  it('service → solo servicios', () => {
    expect(filterByTab(data, 'service').map((i) => i.sku)).toEqual(['B']);
  });
  it('urgent → solo urgentes', () => {
    expect(filterByTab(data, 'urgent').map((i) => i.sku)).toEqual(['C']);
  });
  it('current_inventory / default → todo', () => {
    expect(filterByTab(data, 'current_inventory')).toHaveLength(3);
    expect(filterByTab(data, 'otro')).toHaveLength(3);
  });
});

describe('filterResults', () => {
  const data = [
    item({ sku: 'ABC', itemName: 'Bomba', category: 'Agua', status: 'Urgente', currentLevel: 5, isService: false }),
    item({ sku: 'XYZ', itemName: 'Filtro', category: 'Aire', status: 'Pedir', currentLevel: null, isService: true }),
  ];
  it('búsqueda por sku/nombre/categoría (case-insensitive)', () => {
    expect(filterResults(data, 'main', { ...allFilters, filter: 'bomba' }).map((i) => i.sku)).toEqual(['ABC']);
    expect(filterResults(data, 'main', { ...allFilters, filter: 'aire' }).map((i) => i.sku)).toEqual(['XYZ']);
  });
  it('filtro de estatus se ignora en la pestaña urgent', () => {
    // statusFilter='Pedir' pero en 'urgent' no aplica → devuelve ambos
    expect(filterResults(data, 'urgent', { ...allFilters, statusFilter: 'Pedir' })).toHaveLength(2);
  });
  it('trackingFilter usa el seguimiento del ERP (isService), no el nivel', () => {
    expect(filterResults(data, 'current_inventory', { ...allFilters, trackingFilter: 'untracked' }).map((i) => i.sku)).toEqual(['XYZ']);
    expect(filterResults(data, 'current_inventory', { ...allFilters, trackingFilter: 'tracked' }).map((i) => i.sku)).toEqual(['ABC']);
  });

  it('un -1 ("bajo demanda") cuenta como CON seguimiento, no como sin configurar', () => {
    // Regresión: antes el filtro usaba currentLevel === -1 como proxy de "sin
    // seguimiento", así que los 952 artículos bajo demanda caían del lado erróneo.
    const bajoDemanda = [item({ sku: 'BD', currentLevel: -1, isService: false })];
    expect(filterResults(bajoDemanda, 'current_inventory', { ...allFilters, trackingFilter: 'tracked' })).toHaveLength(1);
    expect(filterResults(bajoDemanda, 'current_inventory', { ...allFilters, trackingFilter: 'untracked' })).toHaveLength(0);
  });
});

describe('sortResults', () => {
  const data = [item({ sku: 'B', annualValue: 30, manualReview: false }), item({ sku: 'A', annualValue: 10, manualReview: true })];
  it('string asc/desc', () => {
    expect(sortResults(data, 'sku', 'asc').map((i) => i.sku)).toEqual(['A', 'B']);
    expect(sortResults(data, 'sku', 'desc').map((i) => i.sku)).toEqual(['B', 'A']);
  });
  it('numérico asc', () => {
    expect(sortResults(data, 'annualValue', 'asc').map((i) => i.annualValue)).toEqual([10, 30]);
  });
  it('booleano asc (false antes que true)', () => {
    expect(sortResults(data, 'manualReview', 'asc').map((i) => i.manualReview)).toEqual([false, true]);
  });
  it('no muta la entrada', () => {
    const original = data.map((i) => i.sku);
    sortResults(data, 'sku', 'asc');
    expect(data.map((i) => i.sku)).toEqual(original);
  });
});

describe('uniqueManufacturers / uniqueCategories', () => {
  const data = [
    item({ manufacturer: 'Zeta', category: 'Agua', isService: false }),
    item({ manufacturer: 'Alfa', category: 'Aire', isService: false }),
    item({ manufacturer: 'Zeta', category: 'Agua', isService: true }),
  ];
  it('dedup + orden, respetando la pestaña', () => {
    expect(uniqueManufacturers(data, 'main')).toEqual(['Alfa', 'Zeta']);
    expect(uniqueCategories(data, 'main')).toEqual(['Agua', 'Aire']);
    // en 'service' solo el tercero
    expect(uniqueManufacturers(data, 'service')).toEqual(['Zeta']);
  });
});
