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
  plazoPago: 30,
  moneda: 'COP',
  descuentoCabecera: 0,
  cantidadFacturada: 0,
  lineas: [
    {
      sku: '3011026485',
      descripcion: 'O-Ring, P4',
      cantidad: 2,
      valorUnitario: 4315000,
      descuento: 0,
      centroCostos: '330801 CALIBRACION ENVIRO',
      centrosCostosCount: 1,
    },
  ],
};

/** Lee el .xls generado y devuelve la celda {v, t, z} de (fila, columna por nombre). */
function celda(buf: Buffer, filaIdx: number, columna: string) {
  const wb = XLSX.read(buf, { type: 'buffer', cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = XLSX.utils.encode_cell({ r: filaIdx, c: COLUMNS.indexOf(columna) });
  return ws[ref] as { v: unknown; t: string; z?: string } | undefined;
}

describe('serialExcel', () => {
  it('01/01/2019 → 43466, el mismo serial que World Office', () => {
    expect(serialExcel('01/01/2019')).toBe(43466);
  });
  it('11/06/2026 → 46184, el serial del modelo', () => {
    expect(serialExcel('11/06/2026')).toBe(46184);
  });
  it('devuelve un entero, sin componente de hora', () => {
    expect(Number.isInteger(serialExcel('14/07/2026')!)).toBe(true);
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
  it('numero limpio → número; con guion → texto', () => {
    expect(tipar('4315000', 'numero')).toBe(4315000);
    expect(tipar('0.19', 'numero')).toBe(0.19);
    expect(tipar('830-111', 'numero')).toBe('830-111');
  });
  it('fecha → serial; texto → tal cual', () => {
    expect(tipar('01/01/2019', 'fecha')).toBe(43466);
    expect(tipar('AMB-STCALENVIRO-01', 'texto')).toBe('AMB-STCALENVIRO-01');
  });
});

describe('buildWorldOfficeXlsx', () => {
  const buf = () => buildWorldOfficeXlsx(buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG).matriz);

  it('es un .xls binario real (BIFF8), como el modelo', () => {
    // Firma de documento compuesto OLE2 = .xls de Excel 97-2003.
    expect([...buf().subarray(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
  });

  it('la hoja se llama como en el modelo (QueryDef_Exportar)', () => {
    expect(XLSX.read(buf(), { type: 'buffer' }).SheetNames[0]).toBe('QueryDef_Exportar');
  });

  it('la cabecera son las 58 columnas, como texto', () => {
    const wb = XLSX.read(buf(), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(XLSX.utils.decode_range(ws['!ref']!).e.c + 1).toBe(58);
    expect(XLSX.utils.sheet_to_json(ws, { header: 1 })[0]).toEqual(COLUMNS);
  });

  it('Fecha y Vencimiento son celdas de fecha (serial con formato m/d/yy), no número general', () => {
    const fecha = celda(buf(), 1, 'Fecha');
    expect(fecha?.t).toBe('n');
    expect(fecha?.v).toBe(serialExcel('14/07/2026'));
    expect(fecha?.z).toBe('m/d/yy');
    const venc = celda(buf(), 1, 'Vencimiento');
    expect(venc?.t).toBe('n');
    expect(venc?.z).toBe('m/d/yy');
  });

  it('los importes y DocumentoNúmero van como número', () => {
    expect(celda(buf(), 1, 'Valor')?.t).toBe('n');
    expect(celda(buf(), 1, 'Valor')?.v).toBe(4315000);
    expect(celda(buf(), 1, 'Cantidad')?.v).toBe(2);
    expect(celda(buf(), 1, 'Iva')?.v).toBe(0.19);
    expect(celda(buf(), 1, 'DocumentoNúmero')?.t).toBe('n');
    expect(celda(buf(), 1, 'DocumentoNúmero')?.v).toBe(1);
  });

  it('Tercero Interno, Tercero Externo (NIT) y Producto (SKU) van como TEXTO', () => {
    expect(celda(buf(), 1, 'Tercero Interno')?.t).toBe('s');
    expect(celda(buf(), 1, 'Tercero Externo')?.t).toBe('s');
    expect(celda(buf(), 1, 'Tercero Externo')?.v).toBe('899999107');
    expect(celda(buf(), 1, 'Producto')?.t).toBe('s');
    expect(celda(buf(), 1, 'Producto')?.v).toBe('3011026485');
  });

  it('el mismo contenido que el CSV: una fila de datos por línea', () => {
    const wb = XLSX.read(buf(), { type: 'buffer' });
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    expect(filas.length).toBe(2); // cabecera + 1 línea
  });
});
