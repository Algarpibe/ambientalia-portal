import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serialNorm } from './dominio.js';
import { FST022_MAX_COLUMNAS, FST022_MAX_FILAS, FST022_MAX_TEXTO, columnasFst022, prepararFst022, titulosFst022, valorCelda, type Celda } from './fst022.js';
import { MOTIVO_MAX, TzError, parseCongelacion, parsePaginaFst022 } from './types.js';

// Lote 9a: la congelación de la F-ST-022. Aquí, sin base: las reglas puras
// (cabecera de tres filas, qué fila es de equipo, columnas derivadas, recuentos
// de problemas), los validadores del cuerpo, las guardas de la migración 055 y
// la de que NADIE cambia ni borra una fila congelada. Todo con una hoja
// ficticia (el repo es público): clientes y seriales inventados.

const fecha = (v: string): Celda => ({ v, t: 'fecha' });
const error = (v: string): Celda => ({ v, t: 'error' });

/** Las tres filas de títulos tal como las da SheetJS: una celda combinada sólo trae valor en su esquina. */
const CABECERA: Celda[][] = [
  ['Cliente', 'Marca', 'Modelo', 'Serial', 'Hoja Vida', '(Última entrada)', 'Días', 'Mantenimientos', null, null, 'Última  Calibración', 'Vigencia de Calibración (Dias)'],
  [null, null, null, null, 'Documento (HV)_(SERIAL)_(MODELO)', null, null, '2024-2026'],
  [null, null, null, null, null, null, null, 'P', 'Correctivo', 'Calibración'],
];
const equipo = (cliente: Celda, marca: Celda, modelo: Celda, serial: Celda, entrada: Celda = null, calibracion: Celda = null, extra: Celda[] = []): Celda[] => [
  cliente, marca, modelo, serial, serial === null ? null : { v: `HV_${String(valorCelda(serial))}`, enlace: 'https://docs.example/hv' }, entrada, 12, 1, 0, 2, calibracion, 100, ...extra,
];
/** Título suelto, fila vacía, cabecera (filas 3 a 5 de Excel), equipos desde la 6 y, tras un hueco, el pie de totales. */
function hoja(): Celda[][] {
  return [
    ['TRAZABILIDAD MANTENIMIENTOS CLIENTES'],
    [],
    ...CABECERA,
    equipo('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18a00001 ', fecha('2026-01-10'), fecha('2025-10-17')), // 6
    equipo('Cliente Ficticio B', 'GRIMM', 'EDM180C', '18A00001', 'No hay datos', 'N/A'), // 7: serial repetido, otra escritura del modelo
    equipo('Cliente Ficticio C', 'HORIBA', 'APNA-370', 1.8e15, fecha('1900-12-30'), error('#VALUE!')), // 8
    equipo('Cliente Ficticio D', 'Grimm', 'EDM 180D', null, 'FALTA', fecha('2024-03-01')), // 9: sin serial
    equipo(null, 'Thermo', '49i', 'TH-0007', null, null, [1, fecha('2025-05-05')]), // 10: sin cliente; marca «1» y fecha en las columnas sin título
    [],
    equipo('Cliente Ficticio E', 'Grimm', 'EDM 180C', error('#REF!'), error('#NAME?'), null), // 12
    [],
    [null, null, null, null, null, null, null, null, null, null, null, null, 'totalRevisados', 5], // 14
    ['total equipos', 6],
    [null, null, null, null, null, null, null, null, null, null, null, null, '% de avance', 0.83],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'x'], // 17: un valor suelto a la derecha
  ];
}

describe('columnasFst022', () => {
  it('encuentra la cabecera por sus títulos, aunque no empiece en la primera fila, y cuenta sus tres filas', () => {
    expect(columnasFst022(hoja())).toEqual({ fila: 2, filas: 3, cliente: 0, marca: 1, modelo: 2, serial: 3, entrada: 5, calibracion: 10 });
  });

  it('una cabecera de una sola fila no se come la primera fila de datos', () => {
    const A: Celda[][] = [['Serial', 'Cliente', 'Marca', 'Modelo'], ['S-1', 'Cliente Ficticio A', 'Grimm', 'EDM 180C']];
    expect(columnasFst022(A)).toMatchObject({ fila: 0, filas: 1, serial: 0, cliente: 1, entrada: -1, calibracion: -1 });
  });

  it('sin «Cliente» y «Serial» en una misma fila no hay cabecera', () => {
    expect(columnasFst022([['Cliente', 'Marca'], ['Serial']])).toBeNull();
    expect(prepararFst022([['a', 'b']])).toBeNull();
  });

  it('los títulos de cada columna, de arriba abajo', () => {
    const t = titulosFst022(CABECERA);
    expect(t.slice(0, 5)).toEqual(['Cliente', 'Marca', 'Modelo', 'Serial', 'Hoja Vida / Documento (HV)_(SERIAL)_(MODELO)']);
    expect(t.slice(7, 11)).toEqual(['Mantenimientos / 2024-2026 / P', 'Correctivo', 'Calibración', 'Última Calibración']);
  });
});

describe('prepararFst022', () => {
  const p = prepararFst022(hoja())!;
  const de = (fila: number) => p.filas.find((f) => f.fila === fila)!;

  it('guarda toda fila con algo, con su número de fila de Excel y sus celdas tal cual; las vacías no', () => {
    expect(p.filas.map((f) => f.fila)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 17]);
    expect(de(6).celdas).toEqual(hoja()[5]);
    expect(de(8).celdas[3]).toBe(1.8e15);
    expect(de(8).celdas[10]).toEqual({ v: '#VALUE!', t: 'error' });
    expect(p.cabeceras).toEqual(CABECERA);
  });

  it('fila de equipo = bajo la cabecera, con algo en cliente, marca, modelo o serial y que no es del pie de totales', () => {
    expect(p.filas.filter((f) => f.esEquipo).map((f) => f.fila)).toEqual([6, 7, 8, 9, 10, 12]);
    for (const fila of [1, 3, 4, 5, 14, 15, 16, 17]) expect(de(fila).esEquipo).toBe(false);
  });

  it('serial_norm es el serial como lo cruza el portal con Desk (mayúsculas y sin espacios alrededor); un error de Excel no es un serial', () => {
    expect(serialNorm(' 18a00001 ')).toBe('18A00001');
    expect([6, 7, 8, 9, 10, 12].map((f) => de(f).serialNorm)).toEqual(['18A00001', '18A00001', '1800000000000000', null, 'TH-0007', null]);
    expect(de(15).serialNorm).toBeNull();
  });

  it('clave_equipo sólo en las filas que la importación de hoy aceptaría (GRIMM EDM 180 con serial y cliente), con su sufijo si el serial se repite', () => {
    expect(p.filas.filter((f) => f.claveEquipo).map((f) => [f.fila, f.claveEquipo])).toEqual([[6, '18a00001'], [7, '18A00001']]);
    const repetido = prepararFst022([...CABECERA, equipo('Cliente Ficticio A', 'Grimm', 'EDM 180C', 'S-1'), equipo('Cliente Ficticio B', 'grimm ', 'EDM180C', 'S-1')])!;
    expect(repetido.filas.filter((f) => f.esEquipo).map((f) => f.claveEquipo)).toEqual(['S-1', 'S-1-2']);
  });

  it('el resumen sólo lleva recuentos: tamaño, filas de equipo y problemas por tipo', () => {
    expect(p.resumen).toEqual({
      totalFilas: 17,
      totalColumnas: 16,
      filasGuardadas: 14,
      filaCabecera: 3,
      filasEquipo: 6,
      filasConSerial: 4,
      filasEdm180: 4,
      filasOtras: 8,
      problemas: { sin_serial: 2, sin_cliente: 1, serial_repetido: 2, serial_cientifico: 1, error_excel: 2, texto_en_fecha: 2, fecha_imposible: 1 },
    });
    expect(JSON.stringify(p.resumen)).not.toMatch(/Ficticio|18A0/i);
  });

  it('no cambia la matriz que recibe', () => {
    const A = hoja();
    const copia = JSON.stringify(A);
    prepararFst022(A);
    expect(JSON.stringify(A)).toBe(copia);
  });
});

describe('parseCongelacion', () => {
  const SHA = 'a'.repeat(64);
  const cuerpo = (extra: Record<string, unknown> = {}) => ({ archivo: 'F-ST-022 ficticia.xlsx', sha256: SHA, hoja: 'Trazabilidad', matriz: hoja(), ...extra });
  const falla = (body: unknown): TzError => {
    try {
      parseCongelacion(body);
    } catch (e) {
      return e as TzError;
    }
    throw new Error('no falló');
  };

  it('acepta la hoja ficticia y devuelve lo que se guarda', () => {
    const c = parseCongelacion(cuerpo({ motivo: '  La hoja cambió  ' }));
    expect(c).toMatchObject({ archivo: 'F-ST-022 ficticia.xlsx', sha256: SHA, hoja: 'Trazabilidad', motivo: 'La hoja cambió' });
    expect(c.preparada.resumen.filasEquipo).toBe(6);
    expect(parseCongelacion(cuerpo()).motivo).toBeNull();
  });

  it.each([
    ['sha256', { sha256: 'A'.repeat(64) }],
    ['sha256', { sha256: 'abc' }],
    ['sha256', { sha256: undefined }],
    ['archivo', { archivo: '' }],
    ['hoja', { hoja: 'x'.repeat(101) }],
    ['matriz', { matriz: 'no' }],
    ['matriz', { matriz: [] }],
    ['matriz', { matriz: [[], [null, '']] }],
    ['matriz', { matriz: Array.from({ length: FST022_MAX_FILAS + 1 }, () => ['x']) }],
    ['matriz', { matriz: [['a', 'b']] }],
    ['matriz', { matriz: CABECERA }],
    ['matriz[1]', { matriz: [['Cliente', 'Serial'], 'fila'] }],
    ['matriz[0]', { matriz: [Array.from({ length: FST022_MAX_COLUMNAS + 1 }, () => 'Cliente')] }],
    ['matriz[1][0]', { matriz: [['Cliente', 'Serial'], ['x'.repeat(FST022_MAX_TEXTO + 1)]] }],
    ['matriz[1][1]', { matriz: [['Cliente', 'Serial'], ['a', ['b']]] }],
    ['matriz[1][0]', { matriz: [['Cliente', 'Serial'], [{ v: '2026-02-30', t: 'fecha' }]] }],
    ['matriz[1][0]', { matriz: [['Cliente', 'Serial'], [{ v: 'x', t: 'otro' }]] }],
    ['matriz[1][0]', { matriz: [['Cliente', 'Serial'], [{ v: 7, t: 'error' }]] }],
    ['matriz[1][0]', { matriz: [['Cliente', 'Serial'], [{ v: 'x', enlace: 5 }]] }],
    ['matriz[1][0]', { matriz: [['Cliente', 'Serial'], [{ v: 'x', sobra: 1 }]] }],
    ['matriz[1][0]', { matriz: [['Cliente', 'Serial'], ['nulo \u0000 dentro']] }],
    ['matriz[1][0]', { matriz: [['Cliente', 'Serial'], [Number.POSITIVE_INFINITY]] }],
    ['motivo', { motivo: 'x'.repeat(MOTIVO_MAX + 1) }],
    ['motivo', { motivo: 7 }],
  ])('400 en «%s»', (campo, extra) => {
    const e = falla(cuerpo(extra));
    expect(e).toBeInstanceOf(TzError);
    expect(e.status).toBe(400);
    expect(e.field).toBe(campo);
  });

  it('el mensaje de un 400 nunca repite el contenido de una celda', () => {
    const e = falla(cuerpo({ matriz: [['Cliente', 'Serial'], ['Cliente Reservado \u0000', 'SER-SECRETO']] }));
    expect(e.messageEs).not.toMatch(/Reservado|SECRETO/);
  });

  it('la página de la vigente: desde 0 y 500 filas por defecto, con tope', () => {
    expect(parsePaginaFst022({})).toEqual({ desde: 0, limite: 500 });
    expect(parsePaginaFst022({ desde: '120', limite: '1000' })).toEqual({ desde: 120, limite: 1000 });
    for (const q of [{ desde: '-1' }, { desde: 'a' }, { limite: '0' }, { limite: '1001' }, { limite: ['1'] }]) expect(() => parsePaginaFst022(q)).toThrow(TzError);
  });
});

describe('055_trazabilidad_fst022_congelacion.sql', () => {
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/055_trazabilidad_fst022_congelacion.sql', import.meta.url)), 'utf8');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo crea con IF NOT EXISTS, sin semilla y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias).toHaveLength(5);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(SQL).not.toMatch(/\bdesk\./);
  });

  it('como mucho una congelación vigente, y las filas con clave (congelación, fila)', () => {
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_fst022_congelaciones_vigente_uq ON portal\.tmc_fst022_congelaciones \(vigente\) WHERE vigente/);
    expect(sinComentarios).toMatch(/PRIMARY KEY \(congelacion_id, fila\)/);
    expect(sinComentarios).toMatch(new RegExp(`motivo\\s+VARCHAR\\(${MOTIVO_MAX}\\)`));
  });

  it('está apuntada en MIGRATIONS, detrás de la 054, y es la última', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'054_trazabilidad_agenda_historial\.sql',\s*'055_trazabilidad_fst022_congelacion\.sql'\]/);
  });
});

describe('las filas congeladas son inmutables', () => {
  const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

  it('ningún fuente del módulo hace UPDATE ni DELETE (ni TRUNCATE) sobre tmc_fst022_congelada: sólo se inserta y se lee', () => {
    for (const f of ['./repo.ts', './router.ts', './types.ts', './fst022.ts', './registro-estados.ts']) {
      const src = fuente(f);
      expect(src).not.toMatch(/(UPDATE|DELETE\s+FROM|TRUNCATE)[^;`]*tmc_fst022_congelada\b/i);
    }
    const repo = fuente('./repo.ts');
    expect(repo.match(/INSERT INTO portal\.tmc_fst022_congelada\b/g)).toHaveLength(1);
    // De la cabecera sólo se toca la marca de vigente y la firma de quien la reemplaza; nunca se borra.
    expect(repo).not.toMatch(/DELETE\s+FROM\s+portal\.tmc_fst022_congelaciones/i);
    const cambios = [...repo.matchAll(/UPDATE portal\.tmc_fst022_congelaciones\s+SET ([^`]*?)\s+WHERE/g)].map((m) => m[1].replace(/\s+/g, ' '));
    expect(cambios).toEqual(['vigente = FALSE, reemplazada_por_id = $2, reemplazada_por = $3, reemplazada_en = NOW(), reemplazada_motivo = $4']);
  });
});
