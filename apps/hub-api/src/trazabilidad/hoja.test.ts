import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fechaEfectiva, type FilaCalibracion } from './calibraciones.js';
import { estadoCalibracion } from './dominio.js';
import type { Celda, FilaCongelada } from './fst022.js';
import { tablaHoja, textoCelda, type EquipoHoja } from './hoja.js';

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
const tabla = (filas: FilaCongelada[], equipos: EquipoHoja[] = [], calibraciones: FilaCalibracion[] = [], hoy = HOY) => tablaHoja({ hoy, cabeceras: CABECERAS, filas, equipos, calibraciones });

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
    const t = tabla([fila('Cliente Ficticio C', 'Thermo', '49i', 'TH-0007', '2025-11-01')]);
    expect(t.filas[0]).toMatchObject(estadoCalibracion('2025-11-01', HOY));
    expect(t.filas[0]).toMatchObject({ vigenciaDias: 20, estado: 'VENCE_30' });
    expect(JSON.stringify(t)).not.toMatch(/357/);
    expect(tabla([fila('Cliente Ficticio C', 'Thermo', '49i', 'TH-0007', '2025-11-01')], [], [], '2026-11-02').filas[0]).toMatchObject({ vigenciaDias: -1, estado: 'VENCIDA' });
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
      expect(t.filas[i]).toMatchObject(estadoCalibracion(esperada, HOY));
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
      total: 4, enInventario: 2, inactivos: 1, soloHoja: 2, conAvisos: 2, fueraDeHoja: 1, calibracionesSueltas: 0,
      porMarca: [{ clave: 'grimm', marca: 'GRIMM', total: 2 }, { clave: 'horiba', marca: 'Horiba', total: 1 }, { clave: 'thermo', marca: 'Thermo', total: 1 }],
      porEstado: { FUERA_CICLO: 1, VENCIDA: 0, VENCE_30: 1, VENCE_60: 0, VENCE_90: 0, AL_DIA: 1, SIN_FECHA: 1 },
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

describe('sólo lectura', () => {
  const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

  it('la regla es pura: sólo importa el dominio, las calibraciones y los tipos de la congelación, y no mira el reloj', () => {
    const imports = [...fuente('./hoja.ts').matchAll(/^import (type )?.* from '([^']+)';\r?$/gm)].map((m) => `${m[1] ?? ''}${m[2]}`);
    expect(imports.sort()).toEqual(['./calibraciones.js', './dominio.js', 'type ./fst022.js']);
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
