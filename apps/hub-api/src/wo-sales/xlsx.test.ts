import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorldOfficeXlsx, serialExcel, tipar } from './xlsx.js';
import { buildWorldOfficeCsv } from './builder.js';
import { DEFAULT_CONFIG } from './config.js';
import { COLUMNS } from './columns.js';
import type { SalesOrder } from './types.js';

const OV_BASE: SalesOrder = {
  numero: 'OV-2026-138',
  fecha: '2026-07-14',
  clienteNombre: 'ACME S.A.S.',
  nit: '899999107',
  formaPagoZoho: '30 días fecha de factura',
  fechaEntrega: '2026-07-20',
  moneda: 'COP',
  descuentoCabecera: 0,
  cantidadFacturada: 0,
  lineas: [
    {
      sku: 'AMB-STCALENVIRO-01',
      descripcion: 'Calibración Enviro',
      cantidad: 2,
      valorUnitario: 4315000,
      descuento: 0,
      centroCostos: '330801 CALIBRACION ENVIRO',
      centrosCostosCount: 1,
    },
  ],
};

/** Lee el .xls generado y devuelve la celda {v, t} de (fila, columna por nombre). */
function celda(buf: Buffer, filaIdx: number, columna: string) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = XLSX.utils.encode_cell({ r: filaIdx, c: COLUMNS.indexOf(columna) });
  return ws[ref] as { v: unknown; t: string } | undefined;
}

describe('serialExcel', () => {
  it('01/01/2019 → 43466, el mismo serial que la muestra de World Office', () => {
    expect(serialExcel('01/01/2019')).toBe(43466);
  });
  it('devuelve un entero, sin componente de hora', () => {
    const s = serialExcel('14/07/2026')!;
    expect(Number.isInteger(s)).toBe(true);
  });
  it('null si no es una fecha DD/MM/AAAA', () => {
    expect(serialExcel('')).toBeNull();
    expect(serialExcel('2026-07-14')).toBeNull();
  });
});

describe('tipar', () => {
  it('vacío → celda en blanco (null), no 0 ni ""', () => {
    expect(tipar('', 'numero')).toBeNull();
    expect(tipar('', 'texto')).toBeNull();
    expect(tipar('', 'fecha')).toBeNull();
  });
  it('numero limpio → número; con guion (NIT) → texto', () => {
    expect(tipar('4315000', 'numero')).toBe(4315000);
    expect(tipar('0.19', 'numero')).toBe(0.19);
    expect(tipar('830-111', 'numero')).toBe('830-111'); // NIT raro: no se corrompe
  });
  it('fecha → serial; texto → tal cual', () => {
    expect(tipar('01/01/2019', 'fecha')).toBe(43466);
    expect(tipar('OV-2026-138', 'texto')).toBe('OV-2026-138');
  });
});

describe('buildWorldOfficeXlsx', () => {
  const buf = () => buildWorldOfficeXlsx(buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG).matriz);

  it('es un .xls binario real (BIFF8), como la muestra de World Office', () => {
    // Firma de documento compuesto OLE2 = .xls de Excel 97-2003.
    expect([...buf().subarray(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
  });

  it('la cabecera son las 57 columnas, como texto', () => {
    const wb = XLSX.read(buf(), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rango = XLSX.utils.decode_range(ws['!ref']!);
    expect(rango.e.c + 1).toBe(57);
    const cabecera = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] as string[];
    expect(cabecera).toEqual(COLUMNS);
  });

  it('las fechas van como número serial de Excel, no como texto', () => {
    const c = celda(buf(), 1, 'Encab: Fecha'); // 2026-07-14
    expect(c?.t).toBe('n');
    expect(c?.v).toBe(serialExcel('14/07/2026'));
  });

  it('los importes van como número', () => {
    expect(celda(buf(), 1, 'Detalle: Valor Unitario')?.t).toBe('n');
    expect(celda(buf(), 1, 'Detalle: Valor Unitario')?.v).toBe(4315000);
    expect(celda(buf(), 1, 'Detalle: Cantidad')?.v).toBe(2);
    expect(celda(buf(), 1, 'Detalle: IVA')?.v).toBe(0.19);
  });

  it('el consecutivo alfanumérico OV- va como TEXTO (decisión pendiente con Xiomara)', () => {
    const c = celda(buf(), 1, 'Encab: Documento Número');
    expect(c?.t).toBe('s');
    expect(c?.v).toBe('OV-2026-138');
  });

  it('el SKU va como texto', () => {
    expect(celda(buf(), 1, 'Detalle: Producto')?.t).toBe('s');
    expect(celda(buf(), 1, 'Detalle: Producto')?.v).toBe('AMB-STCALENVIRO-01');
  });

  it('el mismo contenido que el CSV: una fila de datos por línea', () => {
    const wb = XLSX.read(buf(), { type: 'buffer' });
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    expect(filas.length).toBe(2); // cabecera + 1 línea
  });
});
