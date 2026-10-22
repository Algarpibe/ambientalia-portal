import { describe, it, expect } from 'vitest';
import { filasOcSugerida, type LineaOcExport } from './suggestedPOExport';

// DATA-334 — el importe estimado es cantidad × precio en coma flotante y la física
// disponible una resta (a mano − comprometido): el Excel de la OC sugerida los
// escribía con residuo (3 × 0,1 = 0.30000000000000004).
function linea(over: Partial<LineaOcExport> = {}): LineaOcExport {
  return {
    sku: 'SKU1', itemName: 'Filtro', status: 'Urgente', physicalAvailable: 0.3 - 0.1,
    reorderPoint: 10.4, incoming: 2, suggestedQty: 3, leadTimeDays: 30, unitPrice: 0.1, amount: 3 * 0.1,
    ...over,
  };
}

describe('filasOcSugerida', () => {
  it('escribe el importe a centavos y la física disponible sin residuo', () => {
    const [fila] = filasOcSugerida([{ vendor: 'Proveedor A', lines: [linea()] }]);
    expect(fila['Importe estimado (USD)']).toBe(0.3);
    expect(fila['Física disponible']).toBe(0.2);
  });

  it('conserva el precio unitario tal cual (es dato de origen, puede tener más de dos decimales)', () => {
    const [fila] = filasOcSugerida([{ vendor: 'Proveedor A', lines: [linea({ unitPrice: 0.125 })] }]);
    expect(fila['Precio (USD)']).toBe(0.125);
  });

  it('mantiene columnas y orden: proveedor por proveedor, punto de pedido entero', () => {
    const filas = filasOcSugerida([
      { vendor: 'A', lines: [linea({ sku: 'X1' }), linea({ sku: 'X2' })] },
      { vendor: 'B', lines: [linea({ sku: 'Y1' })] },
    ]);
    expect(filas.map((f) => [f.Proveedor, f.SKU])).toEqual([['A', 'X1'], ['A', 'X2'], ['B', 'Y1']]);
    expect(filas[0]['Punto de pedido']).toBe(10);
    expect(Object.keys(filas[0])).toEqual([
      'Proveedor', 'SKU', 'Artículo', 'Estatus', 'Física disponible', 'Punto de pedido', 'En camino',
      'Cantidad sugerida', 'Lead time (días)', 'Precio (USD)', 'Importe estimado (USD)',
    ]);
  });
});
