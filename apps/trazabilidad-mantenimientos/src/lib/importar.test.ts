import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { ErrorLectura, fechaCelda, leerArchivo, leerLibro, leerMatriz, norm, sha256Hex } from './importar';

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

// La hoja ENTERA para la congelación (lote 9a). Un libro ficticio con la forma
// de la F-ST-022 de hoy: título suelto, tres filas de títulos con celdas
// combinadas, equipos de varias marcas con datos sucios y el pie de totales.
// Clientes y seriales inventados.
describe('leerLibro: la hoja entera, para congelarla', () => {
  const ERR = { valor: 0x0f, ref: 0x17, nombre: 0x1d };
  function libroFicticio(): ArrayBuffer {
    const A: unknown[][] = [
      ['TRAZABILIDAD MANTENIMIENTOS CLIENTES'],
      [],
      ['Cliente', 'Marca', 'Modelo', 'Serial', 'Hoja Vida', '(Última entrada)', 'Días', 'Mantenimientos', null, null, 'Última Calibración', 'Vigencia de Calibración (Dias)'],
      [null, null, null, null, 'Documento (HV)_(SERIAL)_(MODELO)', null, null, '2024-2026'],
      [null, null, null, null, null, null, null, 'P', 'Correctivo', 'Calibración'],
      ['Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', 'HV_18A00001_EDM180C', new Date(2026, 0, 10), 272, 1, 0, 2, new Date(2025, 9, 17), 357, 1, new Date(2025, 4, 5)],
      ['Cliente Ficticio B', 'HORIBA', 'APNA-370', 1.8e15, null, 'No hay datos', null, 0, 0, 0, 365, null],
      ['Cliente Ficticio C', 'Grimm', 'EDM180C', null, null, 'N/A', null, null, null, null, null, null],
      [],
      [null, null, null, null, null, null, null, null, null, null, null, null, 'totalRevisados', 3],
      ['total equipos', 3],
    ];
    const ws = XLSX.utils.aoa_to_sheet(A, { cellDates: true });
    ws['!merges'] = ['A3:A5', 'B3:B5', 'C3:C5', 'D3:D5', 'H3:J3', 'H4:J4', 'K3:K5'].map((r) => XLSX.utils.decode_range(r));
    ws.E6.l = { Target: 'https://docs.example/hv/18A00001' };
    ws.G6.f = 'TODAY()-F6';
    ws.G7 = { t: 'e', v: ERR.valor };
    ws.K7.z = 'dd/mm/yyyy'; // el número de serie 365 con formato de fecha: 30/12/1900
    ws.L7 = { t: 'e', v: ERR.ref };
    ws.G8 = { t: 'e', v: ERR.nombre };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['otra']]), 'Resumen Cal 2026');
    XLSX.utils.book_append_sheet(wb, ws, 'Trazabilidad Mttos');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  }
  const r = leerLibro(libroFicticio());

  it('la importación de siempre lee lo mismo que antes de ese libro', () => {
    expect(r.hoja).toBe('Trazabilidad Mttos');
    expect(r.filas).toEqual([
      { serial: '18A00001', cliente: 'Cliente Ficticio A', marca: 'Grimm', modelo: 'EDM 180C', fechaFactura: null, hojaVida: 'HV_18A00001_EDM180C', ultimaEntrada: '2026-01-10', ultimaCalibracion: '2025-10-17', entradasSt: null, calibracionesPeriodo: 2, correctivosPeriodo: 0 },
    ]);
    expect(r.descartadas).toEqual([8]);
  });

  it('la matriz trae todas las filas en su sitio (la fila N de Excel es matriz[N-1]) y las vacías, vacías', () => {
    expect(r.matriz).toHaveLength(11);
    expect(r.matriz[0]).toEqual(['TRAZABILIDAD MANTENIMIENTOS CLIENTES']);
    expect(r.matriz[1]).toEqual([]);
    expect(r.matriz[8]).toEqual([]);
    expect(r.matriz[10]).toEqual(['total equipos', 3]);
    expect(r.matriz[9].slice(12)).toEqual(['totalRevisados', 3]);
  });

  it('las tres filas de títulos, con las combinadas sólo en su esquina', () => {
    expect(r.cabeceras).toEqual([
      ['Cliente', 'Marca', 'Modelo', 'Serial', 'Hoja Vida', '(Última entrada)', 'Días', 'Mantenimientos', null, null, 'Última Calibración', 'Vigencia de Calibración (Dias)'],
      [null, null, null, null, 'Documento (HV)_(SERIAL)_(MODELO)', null, null, '2024-2026'],
      [null, null, null, null, null, null, null, 'P', 'Correctivo', 'Calibración'],
    ]);
  });

  it('cada celda tal cual: texto, número, fecha como AAAA-MM-DD, el valor de una fórmula y el destino de un hipervínculo', () => {
    expect(r.matriz[5]).toEqual([
      'Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', { v: 'HV_18A00001_EDM180C', enlace: 'https://docs.example/hv/18A00001' },
      { v: '2026-01-10', t: 'fecha' }, 272, 1, 0, 2, { v: '2025-10-17', t: 'fecha' }, 357, 1, { v: '2025-05-05', t: 'fecha' },
    ]);
  });

  it('los datos sucios se conservan: errores de Excel como error, texto donde va una fecha, una fecha imposible y un serial en notación científica', () => {
    const [, , , serial, hv, entrada, dias, , , , calibracion, vigencia] = r.matriz[6];
    expect(serial).toBe(1.8e15);
    expect(hv).toBeNull();
    expect(entrada).toBe('No hay datos');
    expect(dias).toEqual({ v: '#VALUE!', t: 'error' });
    expect(calibracion).toEqual({ v: '1900-12-30', t: 'fecha' });
    expect(vigencia).toEqual({ v: '#REF!', t: 'error' });
    expect(r.matriz[7]).toEqual(['Cliente Ficticio C', 'Grimm', 'EDM180C', null, null, 'N/A', { v: '#NAME?', t: 'error' }]);
  });

  it('leerArchivo añade la huella sha256 del fichero', async () => {
    const datos = libroFicticio();
    const a = await leerArchivo(datos);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sha256).toBe(await sha256Hex(datos));
    expect(a.matriz).toEqual(r.matriz);
  });
});

describe('sha256Hex', () => {
  it('la huella en hexadecimal y minúsculas (vector de prueba «abc»)', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('norm', () => {
  it('quita tildes, mayúsculas y espacios de más', () => {
    expect(norm('  Última   Calibración ')).toBe('ultima calibracion');
  });
});
