import { describe, it, expect, vi } from 'vitest';
import { hubARawRows, cargarDesdeHub, nombreArchivoDesglosado, type HubConsolidacion } from './hubData';
import { processInventoryData } from './fileProcessor';

// Respuesta del hub con el caso del ejemplo real (data-example, 30/03/26):
// 3200043641 con OV-2026-018 (FACT 8 / ENV 6) y OV-2026-050 (solo ENV 1).
const RESPUESTA: HubConsolidacion = {
  inventory: [
    { sku: '3200043641', item_name: 'Filtro X', quantity_available: 20 },
    { sku: 'SIN-OV', item_name: 'Sin pendientes', quantity_available: 5 },
  ],
  fact: [{ sku: '3200043641', item_name: 'Filtro X', quantity: 8, transaction: 'OV-2026-018' }],
  env: [
    { sku: '3200043641', item_name: 'Filtro X', quantity: 6, transaction: 'OV-2026-018' },
    { sku: '3200043641', item_name: 'Filtro X', quantity: 1, transaction: 'OV-2026-050' },
  ],
  generatedAt: '2026-09-30T12:00:00.000Z',
};

describe('hubARawRows + processInventoryData', () => {
  it('produce las mismas filas que el camino de archivos (fórmulas intactas)', () => {
    const { invData, factData, envData } = hubARawRows(RESPUESTA);
    const out = processInventoryData(invData, factData, envData);

    const filas = out.filter((r) => r.sku === '3200043641');
    expect(filas).toHaveLength(2);
    const comun = {
      sku: '3200043641',
      item_name: 'Filtro X',
      'Existencias Comprometidas en contabilidad (Por facturar)': 8,
      'Existencias Comprometidas en físico (Por Enviar)': 7,
      'Existencias a mano de contabilidad': 20,
      'Existencias a mano físicas': 13, // 20 − 7
      'Disponible para la venta': 12,   // 20 − 8
    };
    expect(filas[0]).toEqual({
      ...comun,
      'Cantidad Por Facturar': 8, 'Por Facturar': 'OV-2026-018',
      'Cantidad Por Entregar': 6, 'Por Entregar': 'OV-2026-018',
    });
    expect(filas[1]).toEqual({
      ...comun,
      'Cantidad Por Facturar': '', 'Por Facturar': '',
      'Cantidad Por Entregar': 1, 'Por Entregar': 'OV-2026-050',
    });
  });

  it('un artículo sin OV pendientes sale en una sola fila con las columnas de OV vacías', () => {
    const { invData, factData, envData } = hubARawRows(RESPUESTA);
    const fila = processInventoryData(invData, factData, envData).filter((r) => r.sku === 'SIN-OV');
    expect(fila).toEqual([{
      sku: 'SIN-OV', item_name: 'Sin pendientes',
      'Existencias Comprometidas en contabilidad (Por facturar)': 0,
      'Existencias Comprometidas en físico (Por Enviar)': 0,
      'Existencias a mano de contabilidad': 5,
      'Existencias a mano físicas': 5,
      'Disponible para la venta': 5,
      'Cantidad Por Facturar': '', 'Por Facturar': '',
      'Cantidad Por Entregar': '', 'Por Entregar': '',
    }]);
  });

  it('sin pendientes en FACT/ENV no rompe (listas vacías)', () => {
    const { invData, factData, envData } = hubARawRows({ ...RESPUESTA, fact: [], env: [] });
    expect(processInventoryData(invData, factData, envData)).toHaveLength(2);
  });
});

describe('cargarDesdeHub', () => {
  const ok = (body: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);

  it('pide /api/inventory-consolidation/data con las cabeceras de auth', async () => {
    const fetchImpl = ok(RESPUESTA);
    const d = await cargarDesdeHub({ apiBase: 'https://hub', headers: { Authorization: 'Bearer t' }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://hub/api/inventory-consolidation/data', { headers: { Authorization: 'Bearer t' } });
    expect(d.inventory).toHaveLength(2);
  });

  it('falla claro si falta VITE_HUB_API_URL', async () => {
    await expect(cargarDesdeHub({ apiBase: '', headers: {}, fetchImpl: ok(RESPUESTA) }))
      .rejects.toThrow(/VITE_HUB_API_URL/);
  });

  it('propaga el HTTP de error (p. ej. 403 sin la app asignada)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response);
    await expect(cargarDesdeHub({ apiBase: 'https://hub', headers: {}, fetchImpl })).rejects.toThrow(/403/);
  });

  it('rechaza una respuesta con formato inesperado', async () => {
    await expect(cargarDesdeHub({ apiBase: 'https://hub', headers: {}, fetchImpl: ok({ inventory: [] }) }))
      .rejects.toThrow(/formato inesperado/);
  });
});

describe('nombreArchivoDesglosado', () => {
  it('usa la fecha de hoy en formato ddmmyy', () => {
    expect(nombreArchivoDesglosado(new Date(2026, 8, 30))).toBe('Resumen_Inventario_300926_Desglosado.xlsx');
    expect(nombreArchivoDesglosado(new Date(2026, 0, 5))).toBe('Resumen_Inventario_050126_Desglosado.xlsx');
  });
});
