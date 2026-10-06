import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { ErrorLectura, fechaCelda, leerLibro, leerMatriz, norm } from './importar';

// Matriz con la forma de la F-ST-022 V2: cabecera en dos filas, «Última
// Calibración» en la segunda, y antes Correctivo / Calibración del periodo.
function cabecera(): unknown[][] {
  const h1: unknown[] = [];
  const h2: unknown[] = [];
  h1[1] = 'Cliente'; h1[2] = 'Marca'; h1[3] = 'Modelo'; h1[4] = 'Serial'; h1[5] = 'Fecha Factura';
  h1[9] = 'Hoja Vida'; h1[10] = '(Última entrada)';
  h2[26] = 'Correctivo'; h2[27] = 'Calibración';
  h2[28] = 'Última  Calibración'; h2[29] = 'Vigencia de Calibración (Dias)';
  h2[31] = ' Numero de entradas servicio técnico -ultimos años';
  return [[], [null, 'TRAZABILIDAD MANTENIMIENTOS CLIENTES'], h1, h2];
}
function fila(cliente: string, marca: string, modelo: unknown, serial: unknown, ultimaCal: unknown, extra: Record<number, unknown> = {}): unknown[] {
  const r: unknown[] = [];
  r[1] = cliente; r[2] = marca; r[3] = modelo; r[4] = serial; r[28] = ultimaCal;
  for (const [k, v] of Object.entries(extra)) r[Number(k)] = v;
  return r;
}

describe('leerMatriz', () => {
  it('se queda sólo con los GRIMM EDM 180 y normaliza el modelo', () => {
    const A = [
      ...cabecera(),
      fila('Cliente Uno', 'Grimm', 'EDM 180C', '18A00001', '2026-10-01', { 9: 'HV_18A00001_EDM180C', 26: 1, 27: 6, 31: 1 }),
      fila('Cliente Uno', 'Horiba', 'APNA-370', '0XX0TEST', '2019-02-20'),
      fila('Cliente Dos', 'Grimm', 'EDM180C', '18A00002', null),
      fila('Cliente Tres', 'grimm ', 'EDM 180D', '18A00003', '2025-03-17'),
      fila('X', 'Grimm', 'EDM 280', '1', '2025-01-01'),
      fila('Y', 'Grimm', 1109, '2', '2025-01-01'),
    ];
    const { filas, descartadas } = leerMatriz(A);
    expect(descartadas).toEqual([]);
    expect(filas.map((f) => [f.serial, f.modelo])).toEqual([
      ['18A00001', 'EDM 180C'],
      ['18A00002', 'EDM 180C'],
      ['18A00003', 'EDM 180D'],
    ]);
    expect(filas[0]).toMatchObject({
      cliente: 'Cliente Uno',
      hojaVida: 'HV_18A00001_EDM180C',
      ultimaCalibracion: '2026-10-01',
      correctivosPeriodo: 1,
      calibracionesPeriodo: 6,
      entradasSt: 1,
    });
    expect(filas[1].ultimaCalibracion).toBeNull();
  });

  it('descarta (y cuenta) los EDM 180 sin serial o sin cliente', () => {
    const A = [...cabecera(), fila('C', 'Grimm', 'EDM 180C', null, '2025-01-01'), fila('', 'Grimm', 'EDM 180C', 'S1', '2025-01-01')];
    expect(leerMatriz(A).descartadas).toEqual([5, 6]);
  });

  it('el serial numérico se lee como texto', () => {
    const A = [...cabecera(), fila('C', 'Grimm', 'EDM 180C', 9083, null)];
    expect(leerMatriz(A).filas[0].serial).toBe('9083');
  });

  it('sin cabecera reconocible → ErrorLectura', () => {
    expect(() => leerMatriz([['a', 'b']])).toThrow(ErrorLectura);
  });

  it('sin «Última calibración» → ErrorLectura', () => {
    const h = cabecera();
    h[3] = [];
    expect(() => leerMatriz(h)).toThrow(/Última calibración/);
  });
});

describe('fechaCelda', () => {
  it('acepta Date, número de serie de Excel y texto ISO', () => {
    expect(fechaCelda(new Date(2026, 9, 1))).toBe('2026-10-01');
    expect(fechaCelda(46296)).toBe('2026-10-01');
    expect(fechaCelda('2026-10-01')).toBe('2026-10-01');
    expect(fechaCelda('01/10/2026')).toBeNull();
    expect(fechaCelda(null)).toBeNull();
  });
});

describe('leerLibro', () => {
  it('lee un .xlsx real con celdas de fecha desde la hoja «Trazabilidad»', () => {
    const A = [...cabecera(), fila('Cliente Cuatro', 'Grimm', 'EDM 180C', '18A00006', new Date(2025, 9, 17))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['otra']]), 'Resumen Cal 2026');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(A, { cellDates: true }), 'Trazabilidad');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const r = leerLibro(buf);
    expect(r.hoja).toBe('Trazabilidad');
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ serial: '18A00006', ultimaCalibracion: '2025-10-17' });
  });
});

describe('norm', () => {
  it('quita tildes, mayúsculas y espacios de más', () => {
    expect(norm('  Última   Calibración ')).toBe('ultima calibracion');
  });
});
