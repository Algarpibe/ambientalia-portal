import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResultsTable } from './components/ResultTable';
import type { AnalysisResult } from './types';

// La pestaña "Inventario Actual" muestra también el lead time del artículo (campo
// Lead Time de Zoho) y su desviación, igual que el Análisis Principal.

vi.mock('./utils/preferences', () => ({
  fetchColumnPrefs: vi.fn(() => Promise.resolve(null)),
  saveColumnPrefs: vi.fn(),
}));

const ARTICULO: AnalysisResult = {
  sku: 'SKU-1', itemName: 'Filtro HEPA', currentLevel: 5, leadTimeDays: 45, leadTimeMonths: 1.5,
  leadTimeStdDays: 0, leadTimeSource: 'Zoho', safetyStock: 2, reorderPoint: 10, optimalQuantity: 5,
  deviation: 0.2, status: 'Urgente', levelStatus: 'Subir', itemStatus: 'active', coverageDays: 12,
  coverageRisk: true, orderDate: '', etaDate: '', etaDays: 0, unitCost: 10, annualValue: 1000,
  annualValueRevenue: 1500, coefVariation: 0.3, abcClass: 'A', xyzClass: 'X', abcXyz: 'AX',
  abcClassRevenue: 'A', abcXyzRevenue: 'AX', demandPattern: 'Suave', adi: 1, cv2: 0.1,
  crostonForecast: 3, monthsSinceLastSale: 1, deadStockClass: 'Activo', deadStockValue: 0,
  overstockUnits: 0, overstockValue: 0, inventoryValue: 20, monthlyAverage: 3, annualSales: 36,
  stdDev: 1, demandSource: 'Ventas 2025', manualReview: false, variabilityRatio: 1, category: 'Filtros',
  isService: false, unitPrice: 20, orderedQuantity: 0, handQuantity: 2, physicalHandQuantity: 2,
  committedQuantity: 0, availableQuantity: 2, futureAvailable: 2, manufacturer: 'Horiba',
  vendor: 'Proveedor Uno', erpLevel: 5, variabilityClass: 'Baja', demandType: 'Normal',
  valueClass: 'Estándar', history: { '2025': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
};

beforeEach(() => {
  localStorage.clear();
});

describe('Inventario Actual — columnas de lead time', () => {
  it('incluye "LT (Días)" y "σ LT (Días)"', () => {
    render(
      <ResultsTable
        data={[ARTICULO]}
        eoqOrderCost={50}
        eoqHoldingRate={20}
        onEoqOrderCostChange={() => {}}
        onEoqHoldingRateChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Inventario Actual/ }));
    expect(screen.getByRole('columnheader', { name: /^LT \(Días\)/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /σ LT \(Días\)/ })).toBeInTheDocument();
  });
});
