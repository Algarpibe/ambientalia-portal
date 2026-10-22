import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ResultsTable } from './components/ResultTable';
import SuggestedPO from './components/SuggestedPO';
import UrgentOrdersWidget from './widgets/UrgentOrdersWidget';
import type { AnalysisResult } from './types';
import type { UrgentRow } from './widgets/analysis';

// FE-419 — el análisis de inventario se tiene que poder usar con teclado y lector de
// pantalla: filtros con nombre, cabeceras ordenables que son botones y declaran su orden,
// filas que abren la justificación también con Enter, un detalle que es un diálogo modal de
// verdad (nombre, foco dentro al abrir, Escape cierra y el foco vuelve a la fila) y los
// desplegables en línea que dicen si están abiertos. Se prueba por roles y nombres
// accesibles, que es lo que percibe quien no usa el ratón.

vi.mock('./utils/preferences', () => ({
  fetchColumnPrefs: vi.fn(() => Promise.resolve(null)),
  saveColumnPrefs: vi.fn(),
}));

const ARTICULO: AnalysisResult = {
  sku: 'SKU-1', itemName: 'Filtro HEPA', currentLevel: 5, leadTimeDays: 30, leadTimeMonths: 1,
  leadTimeStdDays: 2, leadTimeSource: 'OC', safetyStock: 2, reorderPoint: 10, optimalQuantity: 5,
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

function renderTabla() {
  return render(
    <ResultsTable
      data={[ARTICULO]}
      eoqOrderCost={50}
      eoqHoldingRate={20}
      onEoqOrderCostChange={() => {}}
      onEoqHoldingRateChange={() => {}}
    />,
  );
}

/** Enfoca la fila y pulsa la tecla, como haría quien navega con Tab. */
function pulsarEnFila(fila: HTMLElement, key: string) {
  fila.focus();
  fireEvent.keyDown(fila, { key });
}

beforeEach(() => {
  localStorage.clear();
});

describe('Tabla de resultados (FE-419)', () => {
  it('el buscador y los filtros tienen nombre accesible', () => {
    renderTabla();
    expect(screen.getByRole('textbox', { name: 'Buscar SKU o nombre' })).toBeInTheDocument();
    for (const nombre of ['Fabricante', 'Categoría', 'Estatus', 'Variabilidad', 'Tipo de demanda', 'Tipo de valor', 'ABC', 'XYZ', 'Patrón de demanda']) {
      expect(screen.getByRole('combobox', { name: nombre })).toBeInTheDocument();
    }
    // Inventario actual cambia el filtro de estatus por el de seguimiento.
    fireEvent.click(screen.getByRole('button', { name: /Inventario Actual/ }));
    expect(screen.getByRole('combobox', { name: 'Seguimiento' })).toBeInTheDocument();
  });

  it('las cabeceras ordenables son botones y la activa declara su sentido', () => {
    renderTabla();
    // Orden inicial: desviación ascendente.
    expect(screen.getByRole('columnheader', { name: /Desviación/ })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'SKU' }));
    const cabecera = screen.getByRole('columnheader', { name: /SKU/ });
    expect(cabecera).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /Desviación/ })).not.toHaveAttribute('aria-sort');
    fireEvent.click(within(cabecera).getByRole('button'));
    expect(cabecera).toHaveAttribute('aria-sort', 'descending');
  });

  it('el panel de columnas dice si está abierto y las celdas de la matriz si filtran', () => {
    renderTabla();
    const columnas = screen.getByRole('button', { name: 'Columnas' });
    expect(columnas).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(columnas);
    expect(columnas).toHaveAttribute('aria-expanded', 'true');
    // El ojo de cada columna es un botón solo-icono: su nombre dice qué hace.
    expect(screen.getAllByRole('button', { name: 'Ocultar la columna SKU' }).length).toBeGreaterThan(0);

    const [celda] = screen.getAllByRole('button', { name: /^AX/ });
    expect(celda).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(celda);
    expect(celda).toHaveAttribute('aria-pressed', 'true');
  });

  it('Enter en una fila abre su justificación como diálogo; Escape lo cierra y el foco vuelve a la fila', () => {
    renderTabla();
    const fila = screen.getByRole('row', { name: 'Abrir la justificación del artículo SKU-1' });
    pulsarEnFila(fila, 'Enter');
    const dialogo = screen.getByRole('dialog', { name: 'Detalle de Justificación: SKU-1 - Filtro HEPA' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(within(dialogo).getByRole('button', { name: 'Cerrar' }));

    const historial = within(dialogo).getByRole('button', { name: 'Configurar columnas de historial' });
    expect(historial).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(historial);
    expect(historial).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(fila);
  });
});

describe('OC sugerida (FE-419)', () => {
  it('el grupo de cada proveedor dice si está desplegado', () => {
    render(<SuggestedPO data={[ARTICULO]} />);
    const grupo = screen.getByRole('button', { name: /Proveedor Uno/ });
    expect(grupo).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(grupo);
    expect(grupo).toHaveAttribute('aria-expanded', 'false');
  });
});

const URGENTE: UrgentRow = {
  manufacturer: 'Horiba', sku: 'SKU-9', itemName: 'Sensor', category: 'Sensores', physical: 1,
  accounting: 1, factoryOrder: 0, committed: 0, available: 1, futureAvailable: 1,
};

vi.mock('./widgets/useInventoryData', () => ({
  useInventoryData: () => ({
    sales2026: [], sales2025: [], sales2024: [], sales2023: [], inventory: [], leadTime: [],
    loading: false, error: null, reload: () => {},
  }),
}));

vi.mock('./widgets/analysis', async (importOriginal) => {
  const real = await importOriginal<typeof import('./widgets/analysis')>();
  return { ...real, urgentOrders: () => [URGENTE] };
});

describe('Widget de pedidos urgentes (FE-419)', () => {
  it('cabeceras botón con aria-sort y el desplegable de columnas con aria-expanded', () => {
    render(<UrgentOrdersWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'SKU' }));
    expect(screen.getByRole('columnheader', { name: /SKU/ })).toHaveAttribute('aria-sort', 'ascending');
    const columnas = screen.getByRole('button', { name: 'Columnas' });
    expect(columnas).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(columnas);
    expect(columnas).toHaveAttribute('aria-expanded', 'true');
  });
});
