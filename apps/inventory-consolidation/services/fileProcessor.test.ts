import { describe, it, expect } from 'vitest';
import { filasParaExcel, processInventoryData } from './fileProcessor';

// DATA-334 — las existencias del desglose salen de sumas y restas en coma flotante
// (contabilidad − comprometido); sin redondear en la frontera del Excel, una resta
// como 0,3 − 0,1 llegaba a la celda como 0.19999999999999998.
describe('filasParaExcel', () => {
  const inv = [{ sku: 'A-1', item_name: 'Filtro', quantity_available: 0.3 }];
  const fact = [
    { sku: 'A-1', item_name: 'Filtro', 'existencias comprometidas': 0.1, 'transacción#': 'OV-1' },
    { sku: 'A-1', item_name: 'Filtro', 'existencias comprometidas': 0.2, 'transacción#': 'OV-2' },
  ];
  const env = [{ sku: 'A-1', item_name: 'Filtro', 'existencias comprometidas': 0.1, 'transacción#': 'OV-1' }];

  it('escribe las cantidades sin residuo de coma flotante', () => {
    const datos = processInventoryData(inv, fact, env);
    // Precondición: el cálculo (y la pantalla) siguen con el residuo; sólo se redondea al exportar.
    expect(datos[0]['Existencias Comprometidas en contabilidad (Por facturar)']).not.toBe(0.3);

    const [fila] = filasParaExcel(datos);
    expect(fila['Existencias Comprometidas en contabilidad (Por facturar)']).toBe(0.3);
    expect(fila['Existencias a mano físicas']).toBe(0.2);
    expect(fila['Disponible para la venta']).toBe(0);
    expect(fila['Existencias a mano de contabilidad']).toBe(0.3);
  });

  it('deja intactos los textos (sku, OV) y las celdas vacías', () => {
    const datos = processInventoryData([{ sku: '0012', item_name: 'Sin OV', quantity_available: 5 }], [], []);
    const [fila] = filasParaExcel(datos);
    expect(fila.sku).toBe('0012');
    expect(fila['Cantidad Por Facturar']).toBe('');
    expect(fila['Por Facturar']).toBe('');
    expect(fila['Existencias a mano de contabilidad']).toBe(5);
  });

  it('no muta los datos que recibe', () => {
    const datos = processInventoryData(inv, fact, env);
    const antes = structuredClone(datos);
    filasParaExcel(datos);
    expect(datos).toEqual(antes);
  });
});
