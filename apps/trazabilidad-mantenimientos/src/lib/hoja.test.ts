import { describe, it, expect } from 'vitest';
import { AVISOS_HOJA, estadoCalibracion, type FilaHoja } from '../dominio';
import { ETIQUETA_AVISO, ETIQUETA_SITUACION, FILTRO_HOJA_VACIO, NOTA_SITUACION, ORDEN_HOJA, etiquetaMarca, filtrarHoja, hayFiltroHoja, ordenarHoja, origenFecha, porSituacion, textoContador, valorEnHoja, type FiltroHoja } from './hoja';

// Lo que calcula la pestaña «Trazabilidad F-ST-022» con la tabla que da el
// servidor: filtros, orden, contador y textos. Clientes y seriales inventados.

const HOY = '2026-10-12';
let n = 5;
const fila = (extra: Partial<FilaHoja> & { ultimaCalibracion?: string | null } = {}): FilaHoja => {
  const ultima = extra.ultimaCalibracion ?? null;
  return { fila: ++n, clave: null, situacion: 'hoja', cliente: 'Cliente Ficticio A', marca: 'Horiba', marcaClave: 'horiba', modelo: 'APNA-370', serial: `HB-${n}`, enHoja: {}, avisos: [], calibraciones: [], ...estadoCalibracion(ultima, HOY), ...extra, ultimaCalibracion: ultima };
};
const A = fila({ cliente: 'Cliente Ficticio Ñandú S.A.S.', marca: 'GRIMM', marcaClave: 'grimm', modelo: 'EDM 180C', serial: '18A00001', clave: '18A00001', situacion: 'inventario', ultimaCalibracion: '2026-09-20', enHoja: { cliente: 'Nandu corto' } });
const B = fila({ cliente: 'Cliente Ficticio B', marca: 'GRIMM', marcaClave: 'grimm', modelo: 'EDM 180D', serial: '18A00002', clave: '18A00002', situacion: 'inactivo', ultimaCalibracion: '2025-11-20', avisos: ['en_revision'] });
const C = fila({ cliente: 'Cliente Ficticio C', marca: 'HORIBA', serial: '18000000000001', ultimaCalibracion: '2024-03-01', avisos: ['serial_numerico', 'marca_distinta'] });
const D = fila({ cliente: 'Cliente Ficticio D', serial: 'HB-0002', ultimaCalibracion: '2025-09-01' });
const E = fila({ cliente: 'cliente ficticio e', marca: 'Thermo', marcaClave: 'thermo', modelo: '49i', serial: 'TH-0007', avisos: ['sin_fecha'] });
const TODAS = [A, B, C, D, E];
const con = (f: Partial<FiltroHoja>) => filtrarHoja(TODAS, { ...FILTRO_HOJA_VACIO, ...f }).map((x) => x.serial);

describe('filtros', () => {
  it('sin filtro salen todas, en el orden en que llegan', () => {
    expect(filtrarHoja(TODAS, FILTRO_HOJA_VACIO)).toEqual(TODAS);
    expect(hayFiltroHoja(FILTRO_HOJA_VACIO)).toBe(false);
  });

  it('el texto busca en cliente, serial y modelo, sin distinguir mayúsculas ni tildes, y también en lo que decía la hoja', () => {
    expect(con({ texto: 'ÑANDU' })).toEqual(['18A00001']);
    expect(con({ texto: 'nandu corto' })).toEqual(['18A00001']);
    expect(con({ texto: '  18a0000 ' })).toEqual(['18A00001', '18A00002']);
    expect(con({ texto: 'edm 180d' })).toEqual(['18A00002']);
    expect(con({ texto: 'FICTICIO E' })).toEqual(['TH-0007']);
    expect(con({ texto: 'no está' })).toEqual([]);
    expect(hayFiltroHoja({ ...FILTRO_HOJA_VACIO, texto: ' ' })).toBe(false);
  });

  it('la marca filtra por su grupo: «HORIBA» y «Horiba» son la misma; varias marcas suman', () => {
    expect(con({ marcas: ['horiba'] })).toEqual(['18000000000001', 'HB-0002']);
    expect(con({ marcas: ['horiba', 'thermo'] })).toEqual(['18000000000001', 'HB-0002', 'TH-0007']);
  });

  it('el estado, la situación (un inactivo también es del inventario) y «sólo con avisos»; todos a la vez se cruzan', () => {
    expect(con({ estados: ['SIN_FECHA', 'AL_DIA'] })).toEqual(['18A00001', 'TH-0007']);
    expect(con({ situacion: 'inventario' })).toEqual(['18A00001', '18A00002']);
    expect(con({ situacion: 'hoja' })).toEqual(['18000000000001', 'HB-0002', 'TH-0007']);
    expect(con({ soloAvisos: true })).toEqual(['18A00002', '18000000000001', 'TH-0007']);
    expect(con({ soloAvisos: true, situacion: 'hoja', marcas: ['horiba'] })).toEqual(['18000000000001']);
    expect(hayFiltroHoja({ ...FILTRO_HOJA_VACIO, soloAvisos: true })).toBe(true);
  });

  it('el contador dice cuántas se ven de cuántas hay', () => {
    expect([textoContador(366, 366), textoContador(12, 366), textoContador(1, 1), textoContador(0, 366)]).toEqual(['366 equipos', '12 de 366 equipos', '1 equipo', '0 de 366 equipos']);
  });
});

describe('orden', () => {
  const orden = (k: Parameters<typeof ordenarHoja>[1]['k'], dir: 1 | -1 = 1) => ordenarHoja([D, B, E, A, C], { k, dir }).map((x) => x.serial);

  it('por defecto, el de la hoja (su número de fila), y no toca la lista que recibe', () => {
    const lista = [D, B, E, A, C];
    expect(ordenarHoja(lista, ORDEN_HOJA)).toEqual(TODAS);
    expect(lista).toEqual([D, B, E, A, C]);
  });

  it('por cliente (sin mayúsculas ni tildes), marca, modelo y serial, hacia arriba y hacia abajo', () => {
    expect(orden('cliente')).toEqual(['18A00002', '18000000000001', 'HB-0002', 'TH-0007', '18A00001']);
    expect(orden('cliente', -1)).toEqual(['18A00001', 'TH-0007', 'HB-0002', '18000000000001', '18A00002']);
    expect(orden('marca')).toEqual(['18A00001', '18A00002', '18000000000001', 'HB-0002', 'TH-0007']);
    expect(orden('serial')).toEqual(['18000000000001', '18A00001', '18A00002', 'HB-0002', 'TH-0007']);
    expect(orden('modelo')[0]).toBe('TH-0007');
  });

  it('por fecha, las que no tienen van siempre al final; por vigencia, lo urgente arriba y «vencida +1 año» y «sin fecha» al final', () => {
    expect(orden('ultimaCalibracion')).toEqual(['18000000000001', 'HB-0002', '18A00002', '18A00001', 'TH-0007']);
    expect(orden('ultimaCalibracion', -1)).toEqual(['18A00001', '18A00002', 'HB-0002', '18000000000001', 'TH-0007']);
    expect(orden('vigencia')).toEqual(['HB-0002', '18A00002', '18A00001', '18000000000001', 'TH-0007']);
  });

  it('por situación: inventario, inactivo y sólo en la hoja; a igualdad, el orden de la hoja', () => {
    expect(orden('situacion')).toEqual(['18A00001', '18A00002', '18000000000001', 'HB-0002', 'TH-0007']);
  });
});

describe('textos', () => {
  it('de dónde sale la fecha: la calibración que cuenta o, si no hay ninguna y hay fecha, el inventario', () => {
    const cal = (origen: 'fst022' | 'desk' | 'manual', extra = {}) => ({ id: 1, fecha: '2026-01-01', origen, ticket: null, corrigeTicket: null, estado: 'vigente' as const, cuenta: true, ...extra });
    expect(origenFecha({ ...A, calibraciones: [{ ...cal('fst022'), cuenta: false }, cal('desk', { ticket: 1001 })] })).toBe('Ticket n.º 1001');
    expect(origenFecha({ ...A, calibraciones: [cal('fst022')] })).toBe('Hoja F-ST-022');
    expect(origenFecha({ ...A, calibraciones: [cal('manual', { corrigeTicket: 77 })] })).toBe('Manual (corrige el ticket n.º 77)');
    expect(origenFecha(A)).toBe('Inventario del portal');
    expect(origenFecha(E)).toBe('');
  });

  it('lo que decía la hoja: lo distinto, o lo mismo que hoy; nada en un equipo que no está en la hoja', () => {
    expect([valorEnHoja(A, 'cliente'), valorEnHoja(A, 'serial')]).toEqual(['Nandu corto', '18A00001']);
    expect(valorEnHoja({ ...A, enHoja: { ultimaCalibracion: null } }, 'ultimaCalibracion')).toBeNull();
    expect(valorEnHoja(A, 'ultimaCalibracion')).toBe('2026-09-20');
    expect(valorEnHoja({ ...A, fila: null }, 'cliente')).toBeNull();
  });

  it('cada aviso y cada situación tienen su texto en claro, y una marca vacía se nombra', () => {
    expect(Object.keys(ETIQUETA_AVISO).sort()).toEqual([...AVISOS_HOJA].sort());
    for (const t of Object.values(ETIQUETA_AVISO)) expect(t).toMatch(/^[A-ZÁÉÍÓÚ].{8,}/);
    expect(ETIQUETA_AVISO.serial_numerico).toMatch(/ceros a la izquierda/);
    expect(ETIQUETA_SITUACION).toEqual({ inventario: 'En el inventario', inactivo: 'En el inventario · inactivo', enlazado: 'Enlazado con Desk 2.0 · fuera de seguimiento', hoja: 'Sólo en la hoja' });
    expect([etiquetaMarca('Horiba'), etiquetaMarca('')]).toEqual(['Horiba', '(sin marca)']);
  });
});

// Lote 9d-2a: las otras marcas, enlazadas con Desk 2.0 fuera de seguimiento.
describe('filas enlazadas fuera de seguimiento', () => {
  const F = fila({ cliente: 'Cliente Ficticio H S.A.S.', serial: 'HB-0009', clave: 'HB-0009', situacion: 'enlazado', enHoja: { cliente: 'Cliente Ficticio H' } });
  const lista = [...TODAS, F];
  const con2 = (f: Partial<FiltroHoja>) => filtrarHoja(lista, { ...FILTRO_HOJA_VACIO, ...f }).map((x) => x.serial);

  it('tienen su propio filtro: ni son «en el inventario» (que es lo que está en seguimiento) ni «sólo en la hoja»', () => {
    expect(con2({ situacion: 'enlazado' })).toEqual(['HB-0009']);
    expect(con2({ situacion: 'inventario' })).toEqual(['18A00001', '18A00002']);
    expect(con2({ situacion: 'hoja' })).toEqual(['18000000000001', 'HB-0002', 'TH-0007']);
    expect(hayFiltroHoja({ ...FILTRO_HOJA_VACIO, situacion: 'enlazado' })).toBe(true);
  });

  it('cuántas hay de cada situación (la ficha de las enlazadas no viene en el resumen del servidor) y, al ordenar por situación, van tras el inventario y antes de lo que sólo está en la hoja', () => {
    expect(porSituacion(lista)).toEqual({ inventario: 1, inactivo: 1, enlazado: 1, hoja: 3 });
    expect(porSituacion([])).toEqual({ inventario: 0, inactivo: 0, enlazado: 0, hoja: 0 });
    expect(ordenarHoja([E, F, B, A], { k: 'situacion', dir: 1 }).map((x) => x.serial)).toEqual(['18A00001', '18A00002', 'HB-0009', 'TH-0007']);
  });

  it('la nota del panel dice, según la situación, por qué no entra en Resumen ni Avisos y dónde se corrige', () => {
    expect(NOTA_SITUACION.enlazado).toMatch(/fuera de seguimiento.*Desk 2\.0.*no entra en Resumen, Equipos, Calendario ni Avisos/);
    expect(NOTA_SITUACION.hoja).toMatch(/sólo está en la hoja/);
    expect(NOTA_SITUACION.inactivo).toMatch(/inactivo/);
  });
});
