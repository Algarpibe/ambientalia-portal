import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fechaEfectiva, type FilaCalibracion } from './calibraciones.js';
import { estadoCalibracion } from './dominio.js';
import type { Celda, FilaCongelada } from './fst022.js';
import { tablaHoja, textoCelda, type EquipoHoja } from './hoja.js';
import { CLAVE_EDM180, SEGUN_CONTRATO } from './marcas.js';

// La tabla de la pestaña «Trazabilidad F-ST-022» (lote 9d-1), sin base: la regla
// pura que casa cada fila de la hoja congelada con el inventario y le pone su
// fecha de HOY. Clientes y seriales inventados (el repo es público).

const HOY = '2026-10-12';
const CABECERAS: Celda[][] = [['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)']];
const fecha = (v: string): Celda => ({ v, t: 'fecha' });

let n = 5;
/** Una fila de equipo de la hoja, en la fila siguiente. La «Vigencia» congelada (357) es un número viejo: no debe salir nunca. */
function fila(cliente: Celda, marca: Celda, modelo: Celda, serial: Celda, ultima: string | null, claveEquipo: string | null = null): FilaCongelada {
  return { fila: ++n, celdas: [cliente, marca, modelo, serial, ultima ? fecha(ultima) : null, 357], esEquipo: true, serialNorm: String(serial ?? '').trim().toUpperCase() || null, claveEquipo };
}
const equipo = (clave: string, extra: Partial<EquipoHoja> = {}): EquipoHoja => ({ clave, serial: clave, cliente: 'Cliente Ficticio A S.A.S.', marca: 'GRIMM', modelo: 'EDM 180C', activo: true, ultimaCalibracion: null, ...extra });
let id = 0;
const cal = (clave: string | null, serial: string, f: string, extra: Partial<FilaCalibracion> = {}): FilaCalibracion => ({ id: ++id, clave, serial, deskEquipoId: null, fecha: f, origen: 'desk', ticket: 1000 + id, estado: 'vigente', corrigeTicket: null, corrigeFecha: null, anuladaAMano: false, ...extra });
/**
 * Lote 11: sin nada guardado, Horiba y Thermo NO vencen. Estas pruebas son de cómo se arma la tabla, así que les ponen 365 días (como si
 * alguien los hubiera guardado); las de la vigencia por defecto pasan `new Map()`.
 */
const THERMO_365: ReadonlyMap<string, number | null> = new Map([['thermo', 365], ['horiba', 365]]);
const tabla = (filas: FilaCongelada[], equipos: EquipoHoja[] = [], calibraciones: FilaCalibracion[] = [], hoy = HOY, vigencias = THERMO_365) => tablaHoja({ hoy, cabeceras: CABECERAS, filas, equipos, calibraciones, vigencias });

describe('una fila por fila de equipo de la hoja, en su orden', () => {
  it('las filas que no son de un equipo (títulos, cabecera) no salen, y el orden es el de la hoja aunque lleguen desordenadas', () => {
    const a = fila('Cliente Ficticio A', 'Thermo', '49i', 'TH-1', '2026-01-10');
    const b = fila('Cliente Ficticio B', 'Thermo', '49i', 'TH-2', '2026-02-10');
    const titulo: FilaCongelada = { fila: 1, celdas: ['TRAZABILIDAD'], esEquipo: false, serialNorm: null, claveEquipo: null };
    const t = tabla([b, titulo, a]);
    expect(t.filas.map((f) => [f.fila, f.serial])).toEqual([[a.fila, 'TH-1'], [b.fila, 'TH-2']]);
  });

  it('una fila que no está en el inventario lleva los valores de la hoja tal cual, sin «en la hoja», y su situación es «hoja»', () => {
    const [f] = tabla([fila(' Cliente Ficticio C ', 'Thermo', '49i', 'TH-0007', '2026-03-01')]).filas;
    expect(f).toMatchObject({ clave: null, situacion: 'hoja', cliente: 'Cliente Ficticio C', marca: 'Thermo', modelo: '49i', serial: 'TH-0007', enHoja: {}, ultimaCalibracion: '2026-03-01' });
  });

  it('la vigencia y el estado se recalculan a hoy con la regla de siempre: el número congelado de la hoja no sale', () => {
    const t = tabla([fila('Cliente Ficticio C', 'Thermo', '49i', 'TH-0007', '2025-11-01')], [], [], HOY, THERMO_365);
    expect(t.filas[0]).toMatchObject(estadoCalibracion('2025-11-01', HOY, 365));
    expect(t.filas[0]).toMatchObject({ vigenciaDias: 20, estado: 'VENCE_30', vigenciaMarca: 365 });
    expect(JSON.stringify(t)).not.toMatch(/357/);
    expect(tabla([fila('Cliente Ficticio C', 'Thermo', '49i', 'TH-0007', '2025-11-01')], [], [], '2026-11-02', THERMO_365).filas[0]).toMatchObject({ vigenciaDias: -1, estado: 'VENCIDA' });
  });

  // Lote 11: la vigencia es la de la MARCA de cada fila. Sin nada guardado, GRIMM vence a los 365 días y las demás no vencen: se ven con
  // su fecha, pero sin «vence» ni días. La de un equipo en seguimiento es siempre la de GRIMM EDM 180; la de uno fuera, la de su marca;
  // la de una fila sólo de la hoja, la de la marca escrita en ella.
  it('con la vigencia de su marca: GRIMM (en seguimiento o de otro modelo) 365 días; Horiba y Thermo, sin vencimiento salvo lo guardado', () => {
    const filas = [
      fila('Cliente Ficticio A', 'GRIMM', 'EDM 180C', '18A00001', '2025-09-01', '18A00001'),
      fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-0001', '2025-09-01'),
      fila('Cliente Ficticio B', 'Thermo', '49i', 'TH-0001', '2019-01-01'),
      fila('Cliente Ficticio C', 'Grimm', 'EDM 280', '28A00001', '2025-09-01'),
      fila('Cliente Ficticio D', 'Horiba', 'APNA-370', 'HB-0002', null),
    ];
    const equipos = [equipo('18A00001', { ultimaCalibracion: '2025-09-01', marca: 'Horiba' }), equipo('HB-0001', { marca: 'HORIBA', enSeguimiento: false })];
    const estados = (t: ReturnType<typeof tabla>) => t.filas.map((f) => [f.serial, f.estado, f.vence, f.vigenciaMarca]);
    expect(estados(tabla(filas, equipos, [], HOY, new Map()))).toEqual([
      ['18A00001', 'VENCIDA', '2026-09-01', 365],
      ['HB-0001', 'SIN_VENCIMIENTO', null, null],
      ['TH-0001', 'SIN_VENCIMIENTO', null, null],
      ['28A00001', 'VENCIDA', '2026-09-01', 365],
      ['HB-0002', 'SIN_FECHA', null, null],
    ]);
    const conHoriba = tabla(filas, equipos, [], HOY, new Map([['horiba', 730], ['grimm', null], [CLAVE_EDM180, null]]));
    expect(estados(conHoriba).map((x) => x.slice(1))).toEqual([['VENCIDA', '2026-09-01', 365], ['AL_DIA', '2027-09-01', 730], ['SIN_VENCIMIENTO', null, null], ['SIN_VENCIMIENTO', null, null], ['SIN_FECHA', null, 730]]);
    expect(conHoriba.resumen.porEstado).toMatchObject({ VENCIDA: 1, AL_DIA: 1, SIN_VENCIMIENTO: 2, SIN_FECHA: 1 });
  });

  // Lote 12: una marca «según contrato» vence, en cada fila, con la frecuencia de preventivo de su cliente: el del inventario si la fila es
  // de un equipo, el escrito en la hoja si no. Sin frecuencia (o «sin contrato»), sin vencimiento. GRIMM EDM 180, 365 siempre.
  it('«según contrato»: cada fila con la frecuencia de SU cliente (6 meses = 183 días); sin ella, sin vencimiento', () => {
    const filas = [
      fila('Cliente Ficticio A', 'GRIMM', 'EDM 180C', '18A00001', '2025-09-01', '18A00001'),
      fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-0001', '2025-09-01'),
      fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-0002', '2025-09-01'),
      fila('Cliente Ficticio C', 'Horiba', 'APNA-370', 'HB-0003', '2025-09-01'),
    ];
    // HB-0001 es de un equipo cuyo cliente en el inventario es otro nombre: manda el del inventario (el que se ve en la fila).
    const equipos = [equipo('18A00001', { ultimaCalibracion: '2025-09-01' }), equipo('HB-0001', { marca: 'Horiba', cliente: 'Cliente Ficticio B S.A.S.', enSeguimiento: false })];
    const t = tablaHoja({ hoy: HOY, cabeceras: CABECERAS, filas, equipos, calibraciones: [], vigencias: new Map([['horiba', SEGUN_CONTRATO], [CLAVE_EDM180, SEGUN_CONTRATO]]), contratos: new Map([['cliente ficticio b s.a.s.', 6], ['cliente ficticio b', 12], ['cliente ficticio c', null]]) });
    expect(t.filas.map((f) => [f.serial, f.estado, f.vence, f.vigenciaMarca])).toEqual([
      ['18A00001', 'VENCIDA', '2026-09-01', 365],
      ['HB-0001', 'VENCIDA', '2026-03-03', 183],
      ['HB-0002', 'VENCIDA', '2026-09-01', 365],
      ['HB-0003', 'SIN_VENCIMIENTO', null, null],
    ]);
  });

  it('los números se enseñan como texto, enteros y sin notación científica; y un serial numérico se avisa (pudo perder ceros a la izquierda)', () => {
    expect([textoCelda(18000000000001), textoCelda(1e21), textoCelda(370), textoCelda(1.5), textoCelda(null), textoCelda({ v: '#VALUE!', t: 'error' })]).toEqual(['18000000000001', '1000000000000000000000', '370', '1.5', '', '#VALUE!']);
    const [f, g] = tabla([fila('Cliente Ficticio B', 'Horiba', 370, 18000000000001, '2026-03-01'), fila('Cliente Ficticio B', 'Horiba', 370, 'HB-2', '2026-03-01')]).filas;
    expect([f.serial, f.modelo, f.avisos]).toEqual(['18000000000001', '370', ['serial_numerico']]);
    expect(g.avisos).toEqual([]);
  });
});

describe('enlace con el inventario', () => {
  it('por la clave de la congelada: la fila enseña los valores ACTUALES del inventario y, de lo que difiere, lo que decía la hoja', () => {
    const t = tabla([fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18a00001', '2025-10-17', '18a00001')], [equipo('18a00001', { serial: '18A00001' })]);
    expect(t.filas[0]).toMatchObject({ clave: '18a00001', situacion: 'inventario', cliente: 'Cliente Ficticio A S.A.S.', marca: 'GRIMM', modelo: 'EDM 180C', serial: '18A00001' });
    expect(t.filas[0].enHoja).toEqual({ cliente: 'Cliente Ficticio A', marca: 'Grimm', serial: '18a00001', ultimaCalibracion: '2025-10-17' });
    expect(t.fueraDeHoja).toEqual([]);
  });

  it('la clave manda sobre el serial: un serial corregido en Desk 2.0 no suelta al equipo de su fila', () => {
    const t = tabla([fila('Cliente Ficticio A', 'GRIMM', 'EDM 180C', '18A0001X', null, '18A0001X')], [equipo('18A0001X', { serial: '18A00011' })]);
    expect(t.filas[0]).toMatchObject({ clave: '18A0001X', serial: '18A00011', enHoja: { serial: '18A0001X' } });
  });

  it('sin clave, por serial normalizado si no es ambiguo; un equipo inactivo también es del inventario', () => {
    const t = tabla([fila('Cliente Ficticio A', 'GRIMM', 'EDM 180C', ' 18a00002 ', null)], [equipo('E-2', { serial: '18A00002', activo: false })]);
    expect(t.filas[0]).toMatchObject({ clave: 'E-2', situacion: 'inactivo' });
  });

  it('ambiguos: un serial dos veces en la hoja, o en dos equipos del inventario, no enlaza por serial; ni un equipo ya enlazado por su clave', () => {
    const repetido = tabla([fila('Cliente Ficticio A', 'GRIMM', 'EDM 180C', '18A00003', null), fila('Cliente Ficticio B', 'GRIMM', 'EDM 180C', '18A00003', null)], [equipo('18A00003')]);
    expect(repetido.filas.map((f) => f.situacion)).toEqual(['hoja', 'hoja']);
    expect(repetido.fueraDeHoja.map((f) => f.clave)).toEqual(['18A00003']);
    const dosEquipos = tabla([fila('Cliente Ficticio A', 'GRIMM', 'EDM 180C', '18A00004', null)], [equipo('18A00004'), equipo('18A00004-2', { serial: '18A00004', activo: false })]);
    expect(dosEquipos.filas[0].situacion).toBe('hoja');
    // El equipo X (enlazado por clave a la primera fila) tiene ahora el serial de la segunda: no se reparte dos veces.
    const yaEnlazado = tabla([fila('Cliente Ficticio A', 'GRIMM', 'EDM 180C', 'VIEJO', null, 'X'), fila('Cliente Ficticio A', 'GRIMM', 'EDM 180C', 'NUEVO', null)], [equipo('X', { serial: 'NUEVO' })]);
    expect(yaEnlazado.filas.map((f) => f.clave)).toEqual(['X', null]);
  });

  it('lo que está en el inventario y no casa con ninguna fila va aparte, no mezclado, con su fecha y su estado', () => {
    const t = tabla([fila('Cliente Ficticio C', 'Thermo', '49i', 'TH-0007', null)], [equipo('ALTA-1', { ultimaCalibracion: '2026-09-01' }), equipo('ALTA-2', { activo: false })]);
    expect(t.filas).toHaveLength(1);
    expect(t.fueraDeHoja).toMatchObject([{ fila: null, clave: 'ALTA-1', situacion: 'inventario', ultimaCalibracion: '2026-09-01', estado: 'AL_DIA', enHoja: {} }, { fila: null, clave: 'ALTA-2', situacion: 'inactivo', estado: 'SIN_FECHA' }]);
  });
});

describe('última calibración', () => {
  it('un equipo del inventario: SIEMPRE la misma fecha que enseña Equipos (`fechaEfectiva`), tenga las filas que tenga', () => {
    const casos: [string, string | null, FilaCalibracion[]][] = [
      ['sin-filas', '2025-01-15', []],
      ['partida', '2020-01-01', [cal('partida', 'partida', '2025-10-17', { origen: 'fst022', ticket: null })]],
      ['ticket', '2020-01-01', [cal('ticket', 'ticket', '2025-10-17', { origen: 'fst022', ticket: null }), cal('ticket', 'ticket', '2026-08-03')]],
      ['futura', '2020-01-01', [cal('futura', 'futura', '2025-10-17', { origen: 'fst022', ticket: null }), cal('futura', 'futura', '2026-12-01')]],
      ['anuladas', '2020-01-01', [cal('anuladas', 'anuladas', '2025-10-17', { estado: 'anulada' })]],
      ['revision', null, [cal('revision', 'revision', '2026-08-03', { estado: 'en_revision' })]],
      ['manual', null, [cal('manual', 'manual', '2026-08-03', { ticket: 77 }), cal('manual', 'manual', '2026-05-05', { origen: 'manual', ticket: null, corrigeTicket: 77, corrigeFecha: '2026-08-03' })]],
    ];
    const calibraciones = casos.flatMap((c) => c[2]);
    const t = tabla(casos.map(([clave]) => fila('Cliente Ficticio A', 'GRIMM', 'EDM 180C', clave, '2024-06-06', clave)), casos.map(([clave, respaldo]) => equipo(clave, { ultimaCalibracion: respaldo })), calibraciones);
    for (const [i, [clave, respaldo, filas]] of casos.entries()) {
      const esperada = fechaEfectiva(filas, respaldo, HOY);
      expect([clave, t.filas[i].ultimaCalibracion]).toEqual([clave, esperada]);
      expect(t.filas[i]).toMatchObject(estadoCalibracion(esperada, HOY, 365));
    }
    expect(t.filas.map((f) => f.ultimaCalibracion)).toEqual(['2025-01-15', '2025-10-17', '2026-08-03', '2025-10-17', null, null, '2026-05-05']);
    // De dónde sale: la fila que cuenta va marcada; sin ninguna fila, vale la del inventario y no hay ninguna marcada.
    expect(t.filas.map((f) => f.calibraciones.find((c) => c.cuenta)?.origen ?? null)).toEqual([null, 'fst022', 'desk', 'fst022', null, null, 'manual']);
    expect(t.filas[2].calibraciones.map((c) => [c.fecha, c.ticket, c.cuenta])).toEqual([['2026-08-03', expect.any(Number), true], ['2025-10-17', null, false]]);
    expect(t.filas[4].avisos).toContain('sin_fecha');
    expect(t.filas[5].avisos).toEqual(['sin_fecha', 'en_revision']);
  });

  it('una fila sólo de la hoja: su fecha como punto de partida más las calibraciones sin equipo de ese serial, con la misma regla (la máxima vigente que no pase de hoy)', () => {
    const sueltas = [cal(null, 'hb-1', '2026-07-01'), cal(null, 'HB-1', '2026-12-24'), cal(null, 'HB-1', '2026-09-09', { estado: 'anulada' }), cal(null, 'HB-2', '2023-01-01'), cal(null, 'OTRO', '2026-01-01')];
    const t = tabla([fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-1', '2025-03-01'), fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-2', '2025-03-01'), fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-3', null)], [], sueltas);
    expect(t.filas.map((f) => [f.ultimaCalibracion, f.enHoja])).toEqual([['2026-07-01', { ultimaCalibracion: '2025-03-01' }], ['2025-03-01', {}], [null, {}]]);
    expect(t.filas[0].calibraciones.map((c) => [c.fecha, c.origen, c.estado, c.cuenta])).toEqual([['2026-12-24', 'desk', 'vigente', false], ['2026-09-09', 'desk', 'anulada', false], ['2026-07-01', 'desk', 'vigente', true], ['2025-03-01', 'fst022', 'vigente', false]]);
    expect(t.filas[1].calibraciones.find((c) => c.cuenta)).toMatchObject({ origen: 'fst022', ticket: null });
    expect(t.filas[2]).toMatchObject({ estado: 'SIN_FECHA', vigenciaDias: null, avisos: ['sin_fecha'], calibraciones: [] });
    // La del serial que no está en la hoja no se pierde de vista: se cuenta.
    expect(t.resumen.calibracionesSueltas).toBe(1);
  });

  it('una fecha de la hoja posterior a hoy (o imposible) no cuenta y se avisa', () => {
    const t = tabla([fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-1', '2026-10-13'), fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-2', '1999-12-31'), fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-3', '2026-10-12')]);
    expect(t.filas.map((f) => [f.ultimaCalibracion, f.avisos])).toEqual([[null, ['sin_fecha', 'en_revision']], [null, ['sin_fecha', 'en_revision']], ['2026-10-12', []]]);
  });
});

describe('avisos de la fila', () => {
  it('serial repetido en la hoja: las dos filas lo dicen, y las calibraciones de ese serial no se atribuyen a ninguna', () => {
    const t = tabla([fila('Cliente Ficticio A', 'Horiba', 'APNA-370', 'HB-9', '2025-03-01'), fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'hb-9', '2025-04-01'), fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-8', '2025-04-01')], [], [cal(null, 'HB-9', '2026-07-01')]);
    expect(t.filas.map((f) => [f.ultimaCalibracion, f.avisos])).toEqual([['2025-03-01', ['serial_repetido', 'calibraciones_sin_atribuir']], ['2025-04-01', ['serial_repetido', 'calibraciones_sin_atribuir']], ['2025-04-01', []]]);
    expect(t.resumen.calibracionesSueltas).toBe(1);
  });

  it('marca y modelo escritos de otra forma que el resto: se agrupan (para el filtro) y se avisa en la fila que desentona, pero se enseña lo que hay', () => {
    const t = tabla([
      fila('Cliente Ficticio A', 'Horiba', 'APNA-370', 'HB-1', '2026-03-01'),
      fila('Cliente Ficticio A', 'HORIBA', 'APNA370', 'HB-2', '2026-03-01'),
      fila('Cliente Ficticio A', 'Horiba', 'APNA-370', 'HB-3', '2026-03-01'),
      fila('Cliente Ficticio A', 'Thermo', 49, 'TH-1', '2026-03-01'),
      fila('Cliente Ficticio A', '', 'X', 'SM-1', '2026-03-01'),
    ]);
    expect(t.filas.map((f) => [f.marca, f.marcaClave, f.modelo, f.avisos])).toEqual([
      ['Horiba', 'horiba', 'APNA-370', []],
      ['HORIBA', 'horiba', 'APNA370', ['marca_distinta', 'modelo_distinto']],
      ['Horiba', 'horiba', 'APNA-370', []],
      ['Thermo', 'thermo', '49', []],
      ['', '', 'X', []],
    ]);
    expect(t.resumen.porMarca).toEqual([{ clave: 'horiba', marca: 'Horiba', total: 3 }, { clave: '', marca: '', total: 1 }, { clave: 'thermo', marca: 'Thermo', total: 1 }]);
  });

  it('sin serial se avisa, y no enlaza con nada', () => {
    const [f] = tabla([fila('Cliente Ficticio A', 'Thermo', '49i', null, '2026-03-01')], [equipo('')]).filas;
    expect([f.situacion, f.avisos]).toEqual(['hoja', ['sin_serial']]);
  });
});

describe('resumen', () => {
  it('totales por marca y por estado, cuántas están en el inventario, cuántas sólo en la hoja y cuántas con avisos', () => {
    const t = tabla(
      [
        fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', '2026-06-01', '18A00001'),
        fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00002', '2024-01-01', '18A00002'),
        fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 18000000000001, '2025-11-01'),
        fila('Cliente Ficticio C', 'Thermo', '49i', 'TH-0007', null),
      ],
      [equipo('18A00001', { ultimaCalibracion: '2026-06-01' }), equipo('18A00002', { activo: false, ultimaCalibracion: '2024-01-01' }), equipo('ALTA-1')],
    );
    expect(t.resumen).toEqual({
      total: 4, enInventario: 2, inactivos: 1, soloHoja: 2, conAvisos: 2, retirados: 0, fueraDeHoja: 1, calibracionesSueltas: 0,
      porMarca: [{ clave: 'grimm', marca: 'GRIMM', total: 2 }, { clave: 'horiba', marca: 'Horiba', total: 1 }, { clave: 'thermo', marca: 'Thermo', total: 1 }],
      porEstado: { FUERA_CICLO: 1, VENCIDA: 0, VENCE_30: 1, VENCE_60: 0, VENCE_90: 0, AL_DIA: 1, SIN_VENCIMIENTO: 0, SIN_FECHA: 1 },
    });
  });

  it('sin congelación (ninguna fila): tabla vacía, resumen a cero y el inventario entero aparte', () => {
    const t = tablaHoja({ hoy: HOY, cabeceras: [], filas: [], equipos: [equipo('18A00001')], calibraciones: [] });
    expect(t.filas).toEqual([]);
    expect(t.resumen).toMatchObject({ total: 0, enInventario: 0, soloHoja: 0, conAvisos: 0, fueraDeHoja: 1, porMarca: [] });
    expect(t.fueraDeHoja).toHaveLength(1);
  });

  it('misma entrada, misma tabla, y no toca lo que recibe', () => {
    const filas = [fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', '2026-06-01', '18A00001'), fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-1', '2025-11-01')];
    const equipos = [equipo('18A00001')];
    const calibraciones = [cal(null, 'HB-1', '2026-07-01')];
    const copia = JSON.stringify([filas, equipos, calibraciones]);
    expect(tabla([...filas].reverse(), equipos, calibraciones)).toEqual(tabla(filas, equipos, calibraciones));
    expect(JSON.stringify([filas, equipos, calibraciones])).toBe(copia);
  });
});

// Lote 9d-2a: las demás marcas quedan enlazadas con Desk 2.0, FUERA de seguimiento (058).
describe('una fila enlazada con un equipo fuera de seguimiento', () => {
  const otra = (clave: string, extra: Partial<EquipoHoja> = {}): EquipoHoja => equipo(clave, { cliente: 'Cliente Ficticio H S.A.S.', marca: 'Horiba', modelo: 'APNA-370', enSeguimiento: false, ...extra });

  it('enseña cliente, marca, modelo y serial del maestro y pasa a «enlazado»; debajo, lo de la hoja sólo si es otra cosa (marca y modelo, sin mirar mayúsculas, espacios ni guiones)', () => {
    const t = tabla([fila('Cliente Ficticio H', 'HORIBA', 'apna 370', 'HB-0001', '2026-03-01'), fila('Cliente Ficticio H S.A.S.', 'Horiba', 'APSA-370', 'hb-0002', '2026-03-01')], [otra('HB-0001'), otra('HB-0002')]);
    expect(t.filas.map((f) => [f.clave, f.situacion, f.cliente, f.marca, f.modelo, f.serial, f.enHoja])).toEqual([
      ['HB-0001', 'enlazado', 'Cliente Ficticio H S.A.S.', 'Horiba', 'APNA-370', 'HB-0001', { cliente: 'Cliente Ficticio H' }],
      ['HB-0002', 'enlazado', 'Cliente Ficticio H S.A.S.', 'Horiba', 'APNA-370', 'HB-0002', { modelo: 'APSA-370', serial: 'hb-0002' }],
    ]);
    // Con la marca del maestro en todas, ninguna desentona.
    expect(t.filas.map((f) => f.avisos)).toEqual([[], []]);
    // En un equipo EN seguimiento la comparación sigue siendo literal, como antes.
    expect(tabla([fila('Cliente Ficticio A S.A.S.', 'Grimm', 'EDM 180C', '18A00001', null)], [equipo('18A00001')]).filas[0]).toMatchObject({ situacion: 'inventario', enHoja: { marca: 'Grimm' } });
  });

  it.each([
    ['sólo la fecha de la hoja', '2026-03-01', []],
    ['la hoja y un ticket posterior, guardado sin clave', '2025-03-01', [cal(null, 'hb-0001', '2026-06-30')]],
    ['un ticket anterior a la hoja y otro anulado', '2026-03-01', [cal(null, 'HB-0001', '2025-01-01'), cal(null, 'HB-0001', '2026-09-09', { estado: 'anulada' })]],
    ['la hoja con una fecha posterior a hoy: en revisión', '2027-01-01', [cal(null, 'HB-0001', '2026-02-02')]],
    ['sin fecha en la hoja y sin tickets', null, []],
  ] as [string, string | null, FilaCalibracion[]][])('su última calibración es la MISMA que antes de enlazarla (%s): la hoja como punto de partida más los tickets de su serial', (_caso, enHoja, calibraciones) => {
    const f = fila('Cliente Ficticio H', 'Horiba', 'APNA-370', 'HB-0001', enHoja);
    const [antes] = tabla([f], [], calibraciones).filas;
    const [despues] = tabla([f], [otra('HB-0001', { ultimaCalibracion: null })], calibraciones).filas;
    expect([antes.situacion, despues.situacion]).toEqual(['hoja', 'enlazado']);
    expect([despues.ultimaCalibracion, despues.vence, despues.vigenciaDias, despues.estado, despues.calibraciones]).toEqual([antes.ultimaCalibracion, antes.vence, antes.vigenciaDias, antes.estado, antes.calibraciones]);
    expect(despues.avisos).toEqual(antes.avisos);
    expect(tabla([f], [otra('HB-0001')], calibraciones).resumen.calibracionesSueltas).toBe(0);
  });

  it('las que ya tuviera con su clave también cuentan, y no hay fecha de respaldo del inventario: un alta del maestro nace sin fecha', () => {
    const f = fila('Cliente Ficticio H', 'Horiba', 'APNA-370', 'HB-0001', '2025-03-01');
    const [con] = tabla([f], [otra('HB-0001')], [cal('HB-0001', 'HB-0001', '2026-08-08', { origen: 'manual', ticket: null })]).filas;
    expect([con.ultimaCalibracion, con.calibraciones.map((c) => [c.fecha, c.origen, c.cuenta])]).toEqual(['2026-08-08', [['2026-08-08', 'manual', true], ['2025-03-01', 'fst022', false]]]);
    expect(tabla([fila('Cliente Ficticio H', 'Horiba', 'APNA-370', 'HB-0009', null)], [otra('HB-0009', { ultimaCalibracion: '2020-01-01' })]).filas[0]).toMatchObject({ ultimaCalibracion: null, estado: 'SIN_FECHA' });
  });

  it('lo que el maestro tiene y la hoja no va aparte, también como «enlazado», con los tickets de su serial; inactivo, sigue siendo «enlazado»', () => {
    const t = tabla([fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', null, '18A00001')], [equipo('18A00001'), equipo('ALTA-1'), otra('HB-0007'), otra('HB-0008', { activo: false })], [cal(null, 'HB-0007', '2026-05-05')]);
    expect(t.fueraDeHoja.map((f) => [f.clave, f.situacion, f.ultimaCalibracion])).toEqual([['ALTA-1', 'inventario', null], ['HB-0007', 'enlazado', '2026-05-05'], ['HB-0008', 'enlazado', null]]);
    expect(t.resumen).toMatchObject({ enInventario: 1, inactivos: 0, soloHoja: 0, fueraDeHoja: 3, calibracionesSueltas: 0 });
  });

  it('el resumen sigue contando «en el inventario» sólo lo que está en seguimiento', () => {
    const t = tabla([fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', null, '18A00001'), fila('Cliente Ficticio H', 'Horiba', 'APNA-370', 'HB-0001', null), fila('Cliente Ficticio T', 'Thermo', '49i', 'TH-1', null)], [equipo('18A00001'), otra('HB-0001')]);
    expect(t.filas.map((f) => f.situacion)).toEqual(['inventario', 'enlazado', 'hoja']);
    expect(t.resumen).toMatchObject({ total: 3, enInventario: 1, inactivos: 0, soloHoja: 1 });
  });
});

// Lote 9d-2b: una persona ya puede registrar una calibración manual y anular otra. La regla de la pestaña es la misma;
// lo nuevo es que cada calibración lleva su id y sus firmas, y que la partida de una fila de la hoja se puede anular.
describe('corregir a mano una fila de la hoja (lote 9d-2b)', () => {
  const hoja = () => fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-1', '2026-05-01');
  const firma = { motivo: 'El certificado dice otra fecha.', por: 'tecnico@example.com', en: '2026-10-12 15:00:00+00', anuladaPor: null, anuladaEn: null, anuladaMotivo: null };

  it('una manual guardada por serial (fila sólo de la hoja) cuenta como una calibración más, y sale con su id, quién, cuándo y por qué', () => {
    const f = hoja();
    const manual = { ...cal(null, 'HB-1', '2026-09-30', { origen: 'manual', ticket: null }), ...firma };
    const [x] = tabla([f], [], [manual]).filas;
    expect([x.ultimaCalibracion, x.estado]).toEqual(['2026-09-30', 'AL_DIA']);
    expect(x.calibraciones).toEqual([
      { id: manual.id, fecha: '2026-09-30', origen: 'manual', ticket: null, corrigeTicket: null, estado: 'vigente', cuenta: true, ...firma },
      // La partida de una fila de la hoja no es una fila guardada: su id es el de su fila, en negativo, y no la firma nadie.
      { id: -f.fila, fecha: '2026-05-01', origen: 'fst022', ticket: null, corrigeTicket: null, estado: 'vigente', cuenta: false },
    ]);
  });

  it('la partida de la hoja, anulada a mano (guardada por serial, sin clave), deja de contar y no se vuelve a inventar: así una manual ANTERIOR puede mandar', () => {
    const anulada = { ...cal(null, 'HB-1', '2026-05-01', { origen: 'fst022', ticket: null, estado: 'anulada', anuladaAMano: true }), ...firma, anuladaPor: 'director@example.com', anuladaEn: '2026-10-12 16:00:00+00', anuladaMotivo: 'La hoja tenía el año mal.' };
    const manual = cal(null, 'HB-1', '2025-05-01', { origen: 'manual', ticket: null });
    expect(tabla([hoja()], [], [manual]).filas[0].ultimaCalibracion).toBe('2026-05-01');
    const [x] = tabla([hoja()], [], [anulada, manual]).filas;
    expect([x.ultimaCalibracion, x.estado]).toEqual(['2025-05-01', 'VENCIDA']);
    expect(x.calibraciones.map((c) => [c.id, c.origen, c.estado, c.cuenta])).toEqual([[anulada.id, 'fst022', 'anulada', false], [manual.id, 'manual', 'vigente', true]]);
    expect(x.calibraciones[0]).toMatchObject({ anuladaPor: 'director@example.com', anuladaMotivo: 'La hoja tenía el año mal.' });
    // Con la partida anulada y nada más, la fila queda sin fecha: no vuelve la de la hoja.
    expect(tabla([hoja()], [], [anulada]).filas[0]).toMatchObject({ ultimaCalibracion: null, estado: 'SIN_FECHA' });
  });

  it('en un equipo enlazado fuera de seguimiento, una manual con su clave cuenta, y una que corrige un ticket de su serial lo tapa', () => {
    const q = equipo('HB-1', { marca: 'HORIBA', modelo: 'APNA-370', cliente: 'Cliente Ficticio B S.A.S.', enSeguimiento: false });
    const ticket = cal(null, 'HB-1', '2026-08-01', { ticket: 2001 });
    const corrige = cal('HB-1', 'HB-1', '2026-06-15', { origen: 'manual', ticket: null, corrigeTicket: 2001, corrigeFecha: '2026-08-01' });
    const [x] = tabla([hoja()], [q], [ticket, corrige]).filas;
    expect([x.situacion, x.ultimaCalibracion]).toEqual(['enlazado', '2026-06-15']);
    expect(x.calibraciones.find((c) => c.cuenta)).toMatchObject({ id: corrige.id, origen: 'manual', corrigeTicket: 2001 });
  });
});

// Lote 9d-2b: retirar. Un equipo retirado a mano y una fila de la hoja retirada siguen en la tabla, con quién, cuándo y por qué, y
// dejan de contar en los totales «vivos» (sólo en la hoja, con avisos, por estado). La hoja congelada no cambia.
describe('retirados (lote 9d-2b)', () => {
  const FIRMA = { por: 'director@example.com', en: '2026-10-12 15:00:00+00', motivo: 'El cliente lo dio de baja.' };
  const filas = () => [
    fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', '2026-06-01', '18A00001'),
    fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00002', '2025-11-01', '18A00002'),
    fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-1', '2025-11-01'),
    fila('Cliente Ficticio C', 'Thermo', '49i', 'TH-0007', null),
  ];
  const equipos = (retirado: EquipoHoja['retirado'] = null) => [equipo('18A00001', { ultimaCalibracion: '2026-06-01' }), equipo('18A00002', { activo: !retirado, ultimaCalibracion: '2025-11-01', retirado })];

  it('nadie está retirado mientras nadie lo retire', () => {
    const t = tablaHoja({ hoy: HOY, cabeceras: CABECERAS, filas: filas(), equipos: equipos(), calibraciones: [], vigencias: THERMO_365 });
    expect(t.filas.map((f) => f.retirado)).toEqual([null, null, null, null]);
    expect(t.resumen).toMatchObject({ retirados: 0, soloHoja: 2, conAvisos: 1, porEstado: { AL_DIA: 1, VENCE_30: 2, SIN_FECHA: 1 } });
  });

  it('un equipo retirado a mano sale como inactivo CON su firma; una fila de la hoja retirada, igual; conservan su fecha y su estado', () => {
    const f = filas();
    const t = tablaHoja({ hoy: HOY, cabeceras: CABECERAS, filas: f, equipos: equipos(FIRMA), calibraciones: [], retiradas: [{ fila: f[3].fila, ...FIRMA, motivo: 'Fila duplicada.' }, { fila: 9999, ...FIRMA }], vigencias: THERMO_365 });
    expect(t.filas.map((x) => [x.serial, x.situacion, x.retirado?.motivo ?? null, x.estado])).toEqual([
      ['18A00001', 'inventario', null, 'AL_DIA'],
      ['18A00002', 'inactivo', 'El cliente lo dio de baja.', 'VENCE_30'],
      ['HB-1', 'hoja', null, 'VENCE_30'],
      ['TH-0007', 'hoja', 'Fila duplicada.', 'SIN_FECHA'],
    ]);
    expect(t.filas[1].retirado).toEqual(FIRMA);
    // Los totales «vivos» ya no los cuentan: ni sólo en la hoja, ni con avisos (la retirada no tenía fecha), ni por estado.
    expect(t.resumen).toMatchObject({ total: 4, retirados: 2, enInventario: 2, inactivos: 1, soloHoja: 1, conAvisos: 0, porEstado: { AL_DIA: 1, VENCE_30: 1, SIN_FECHA: 0 } });
  });

  it('un equipo fuera de la hoja (o enlazado fuera de seguimiento) retirado a mano también lo dice', () => {
    const t = tablaHoja({ hoy: HOY, cabeceras: CABECERAS, filas: [], equipos: [equipo('HB-9', { enSeguimiento: false, activo: false, retirado: FIRMA })], calibraciones: [] });
    expect(t.fueraDeHoja).toMatchObject([{ clave: 'HB-9', situacion: 'enlazado', retirado: FIRMA }]);
  });
});

describe('sólo lectura', () => {
  const fuente =(f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

  it('la regla es pura: sólo importa el dominio, las calibraciones, la vigencia por marca (marcas.ts, lote 11) y los tipos de la congelación, y no mira el reloj', () => {
    const imports = [...fuente('./hoja.ts').matchAll(/^import (type )?.* from '([^']+)';\r?$/gm)].map((m) => `${m[1] ?? ''}${m[2]}`);
    expect(imports.sort()).toEqual(['./calibraciones.js', './dominio.js', './marcas.js', 'type ./fst022.js']);
    expect(fuente('./hoja.ts')).not.toMatch(/Date\.now|new Date\(\)/);
  });

  it('ni la regla ni su SQL escriben nada, ni leen Desk (ni la réplica ni Desk 2.0), ni envían nada', () => {
    for (const f of ['./hoja.ts', './hoja-repo.ts']) {
      expect(fuente(f), f).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+portal|DELETE\s+FROM|TRUNCATE|ALTER|CREATE)\b/i);
      expect(fuente(f), f).not.toMatch(/\bdesk\.|db-desk2|getDesk2Pool|\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|setInterval|setTimeout/i);
    }
  });

  it('la ruta de la tabla es una lectura (GET), y el router no gana ninguna escritura con ella', () => {
    const rutas = fuente('./router.ts').split(/\n\s*router\./).slice(1).filter((r) => /^\w+\(\s*'\/trazabilidad\/hoja/.test(r));
    expect(rutas.map((r) => /^(\w+)\(\s*'([^']+)'/.exec(r)!.slice(1).join(' '))).toEqual(['get /trazabilidad/hoja']);
    expect(rutas[0]).not.toMatch(/escritura\(|conPermiso\(|soloAdmin\(/);
  });
});
