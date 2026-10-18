import { describe, it, expect } from 'vitest';
import { estadoCalibracion, type EquipoVista, type FrecuenciaCliente } from '../dominio';
import { efectoFrecuencia, filasContratos, filtrarContratos, frecuenciaDe, frecuenciaElegida, hayClientesSinFrecuencia, lineasVistaFrecuencia, textoCambioFrecuencia, textoContadorContratos, textoContrato, textoMeses } from './contratos';

// La frecuencia de preventivo de un cliente (lote 12), en la ficha de un equipo: cómo se lee, qué se elige, la vista previa (cuántos
// equipos de ese cliente, de marcas «según contrato», entran o salen de «Avisos a clientes») y lo que pasa al confirmar. Nada se envía.

const HOY = '2026-10-17';
let n = 0;
/** Un equipo del inventario. Con `contrato`, su marca vence según contrato y `dias` es la frecuencia de su cliente (null = sin ella). */
function eq(cliente: string, ultima: string | null, contrato: boolean, dias: number | null = null): EquipoVista {
  const serial = `S${++n}`;
  return {
    clave: serial, serial, cliente, marca: contrato ? 'Horiba' : 'GRIMM', modelo: 'X', fechaFactura: null, hojaVida: null, ultimaEntrada: null, ultimaCalibracion: ultima, entradasSt: null, calibracionesPeriodo: null, correctivosPeriodo: null,
    vigenciaMarca: contrato ? dias : 365, segunContrato: contrato, ...estadoCalibracion(ultima, HOY, contrato ? dias : 365), serialRepetido: false, seguimiento: null, ticket: null, contacto: null,
  };
}
const CLAVE = 'cliente ficticio a s.a.s.';
const FIRMA = { por: 'admin@example.com', en: '2026-10-18 20:00:00+00', motivo: 'Contrato ficticio.' };

describe('cómo se lee', () => {
  it('en meses y en días; sin frecuencia, «sin contrato»', () => {
    expect([1, 3, 6, 12, 24].map(textoMeses)).toEqual(['1 mes (30 días)', '3 meses (91 días)', '6 meses (183 días)', '12 meses (365 días)', '24 meses (730 días)']);
    expect(textoMeses(null)).toBe('sin contrato');
  });

  it('la de un cliente, por su clave; sin fila, null', () => {
    const fs: FrecuenciaCliente[] = [{ clave: CLAVE, cliente: 'Cliente Ficticio A S.A.S.', meses: 6, ...FIRMA }];
    expect(frecuenciaDe(fs, CLAVE)?.meses).toBe(6);
    expect(frecuenciaDe(fs, 'otro cliente')).toBeNull();
  });

  it('en la ficha: si su marca va según contrato, cuándo vence con la frecuencia de su cliente (o que no vence sin ella); si no, que no la usa', () => {
    expect(textoContrato(eq('Cliente Ficticio A S.A.S.', '2026-01-01', true, 183), 6)).toBe('Su marca vence según el contrato de su cliente: este equipo vence a los 6 meses (183 días) de su última calibración.');
    expect(textoContrato(eq('Cliente Ficticio A S.A.S.', '2026-01-01', true), null)).toBe('Su marca vence según el contrato de su cliente y este cliente no tiene frecuencia de preventivo: el equipo no vence ni avisa.');
    expect(textoContrato(eq('Cliente Ficticio A S.A.S.', '2026-01-01', false), 6)).toBe('La marca de este equipo no vence según contrato: la frecuencia del cliente sólo cuenta para las marcas «según contrato del cliente».');
  });
});

describe('qué se elige', () => {
  it('«sin contrato» o un número entero de meses de 1 a 36; lo demás no vale (undefined)', () => {
    expect(frecuenciaElegida('sin', 'lo que sea')).toBeNull();
    expect(['1', ' 6 ', '12', '36'].map((t) => frecuenciaElegida('meses', t))).toEqual([1, 6, 12, 36]);
    for (const t of ['', '0', '37', '6.5', 'seis', '-6']) expect(frecuenciaElegida('meses', t), t).toBeUndefined();
  });
});

describe('la vista previa de cambiar la frecuencia de un cliente', () => {
  // Del cliente A: tres equipos «según contrato» (una calibración de hace 8 meses, otra de hace 2 y uno sin fecha) y un GRIMM; del B, uno.
  const equipos = [
    eq('Cliente Ficticio A S.A.S.', '2026-02-10', true),
    eq('CLIENTE FICTICIO A S.A.S. ', '2026-08-10', true),
    eq('Cliente Ficticio A S.A.S.', null, true),
    eq('Cliente Ficticio A S.A.S.', '2025-10-01', false),
    eq('Cliente Ficticio B', '2026-02-10', true),
  ];

  it('de «sin contrato» a 6 meses: cuenta sólo los equipos de ESE cliente cuya marca va según contrato; cuántos entran en avisos', () => {
    expect(lineasVistaFrecuencia(equipos, CLAVE, null, 6, HOY)).toEqual([
      { texto: 'Frecuencia de preventivo', valor: 'sin contrato → 6 meses (183 días)', cambia: true },
      { texto: 'Equipos del cliente que vencen según su contrato', valor: '3' },
      { texto: 'Entran en «Avisos a clientes» (vencidas o por vencer)', valor: '1', aviso: true },
      { texto: 'Salen de «Avisos a clientes»', valor: '0' },
      { texto: 'Vencidas hace más de un año (no piden aviso)', valor: '0' },
      { texto: 'Sin fecha (no vencen ni avisan)', valor: '1' },
    ]);
  });

  it('de 6 meses a 12: la de hace 8 meses sale de avisos (vuelve a estar al día); y a «sin contrato», salen todas', () => {
    const conSeis = equipos.map((e) => (e.segunContrato ? { ...e, vigenciaMarca: 183, ...estadoCalibracion(e.ultimaCalibracion, HOY, 183) } : e));
    expect(lineasVistaFrecuencia(conSeis, CLAVE, 6, 12, HOY).slice(2, 4).map((l) => l.valor)).toEqual(['0', '1']);
    expect(lineasVistaFrecuencia(conSeis, CLAVE, 6, null, HOY).slice(0, 4).map((l) => l.valor)).toEqual(['6 meses (183 días) → sin contrato', '3', '0', '1']);
  });

  it('lo que pasa al confirmar, dicho antes; y si ningún equipo suyo va según contrato, se dice que de momento no cambia nada', () => {
    expect(efectoFrecuencia(3, 6)).toMatch(/^Sus 3 equipos de marcas «según contrato» vencen a los 6 meses \(183 días\) de su última calibración.*No se envía ningún correo/);
    expect(efectoFrecuencia(3, null)).toMatch(/dejan de vencer.*No se envía ningún correo/);
    expect(efectoFrecuencia(0, 6)).toMatch(/^Ningún equipo de este cliente vence hoy según contrato: se guarda y contará cuando su marca vaya «según contrato del cliente»\./);
  });

  it('un apunte del historial, en una línea', () => {
    expect(textoCambioFrecuencia({ id: 1, clave: CLAVE, cliente: 'Cliente Ficticio A S.A.S.', antes: null, despues: 6, ...FIRMA })).toBe('sin contrato → 6 meses (183 días), por admin@example.com el 18/10/2026 15:00: Contrato ficticio.');
  });
});

// Lote 13: la lista de clientes de «Configuración» para rellenar las frecuencias desde una sola pantalla. Sale del inventario que ya
// llega (GET /equipos: los equipos con `segunContrato` y `frecuencias`), sin rutas nuevas.
describe('la lista de clientes con equipos «según contrato»', () => {
  // A: tres según contrato (uno vencido hace 8 meses con 6 meses de contrato → en avisos), escrito de dos formas, y un GRIMM que no cuenta.
  // B: dos según contrato, sin frecuencia. C: uno, con «sin contrato» guardado. D: sólo GRIMM (no sale). Uno sin cliente (no sale).
  const equipos = [
    eq('Cliente Ficticio A S.A.S.', '2026-02-10', true, 183),
    eq('Cliente Ficticio A S.A.S.', '2026-08-10', true, 183),
    eq('CLIENTE FICTICIO A S.A.S. ', null, true, 183),
    eq('Cliente Ficticio A S.A.S.', '2025-10-01', false),
    eq('Cliente Ficticio B', '2026-02-10', true),
    eq('Cliente Ficticio B', '2026-03-10', true),
    eq('Cliente Ficticio C', '2026-02-10', true),
    eq('Cliente Ficticio D', '2025-10-01', false),
    eq('  ', '2026-02-10', true),
  ];
  const frecuencias: FrecuenciaCliente[] = [
    { clave: CLAVE, cliente: 'Cliente Ficticio A S.A.S.', meses: 6, ...FIRMA },
    { clave: 'cliente ficticio c', cliente: 'Cliente Ficticio C', meses: null, ...FIRMA },
    { clave: 'cliente ficticio e', cliente: 'Cliente Ficticio E', meses: 12, ...FIRMA },
  ];

  it('una fila por cliente con equipos «según contrato»: su nombre como más se escribe, cuántos, cuántos en avisos y su frecuencia', () => {
    const filas = filasContratos(equipos, frecuencias);
    expect(filas.map((f) => [f.clave, f.cliente, f.equipos, f.enAvisos, f.meses])).toEqual([
      ['cliente ficticio b', 'Cliente Ficticio B', 2, 0, null],
      ['cliente ficticio c', 'Cliente Ficticio C', 1, 0, null],
      [CLAVE, 'Cliente Ficticio A S.A.S.', 3, 1, 6],
    ]);
    expect(filas[2].frecuencia).toEqual(frecuencias[0]);
    expect(filas[1].frecuencia).toEqual(frecuencias[1]);
    expect(filas[0].frecuencia).toBeNull();
  });

  it('orden: primero los que no tienen frecuencia; dentro, más equipos primero y, a igualdad, por nombre', () => {
    const muchos = [
      eq('Cliente Ficticio Z', '2026-02-10', true),
      eq('Cliente Ficticio Y', '2026-02-10', true),
      eq('Cliente Ficticio X', '2026-02-10', true, 183),
      eq('Cliente Ficticio X', '2026-02-10', true, 183),
      eq('Cliente Ficticio W', '2026-02-10', true, 183),
      eq('Cliente Ficticio V', '2026-02-10', true),
      eq('Cliente Ficticio V', '2026-02-10', true),
    ];
    const fs: FrecuenciaCliente[] = ['cliente ficticio x', 'cliente ficticio w'].map((clave) => ({ clave, cliente: clave, meses: 6, ...FIRMA }));
    expect(filasContratos(muchos, fs).map((f) => f.cliente)).toEqual(['Cliente Ficticio V', 'Cliente Ficticio Y', 'Cliente Ficticio Z', 'Cliente Ficticio X', 'Cliente Ficticio W']);
  });

  it('sin ningún equipo «según contrato», ninguna fila (la tarjeta lo dice y no enseña la tabla)', () => {
    expect(filasContratos(equipos.filter((e) => !e.segunContrato), frecuencias)).toEqual([]);
    expect(filasContratos([], [])).toEqual([]);
  });

  it('filtro «sólo sin frecuencia» y búsqueda por nombre, sin mayúsculas, tildes ni espacios de más', () => {
    const filas = filasContratos(equipos, frecuencias);
    expect(filtrarContratos(filas, { soloSinFrecuencia: true, busqueda: '' }).map((f) => f.clave)).toEqual(['cliente ficticio b', 'cliente ficticio c']);
    expect(filtrarContratos(filas, { soloSinFrecuencia: false, busqueda: '' })).toHaveLength(3);
    expect(filtrarContratos(filas, { soloSinFrecuencia: false, busqueda: '  FICTÍCIO   a ' }).map((f) => f.clave)).toEqual([CLAVE]);
    expect(filtrarContratos(filas, { soloSinFrecuencia: true, busqueda: 'ficticio a' })).toEqual([]);
    expect(filtrarContratos(filas, { soloSinFrecuencia: false, busqueda: 'nadie' })).toEqual([]);
  });

  it('el filtro va encendido de partida sólo si hay algún cliente sin frecuencia; y el contador', () => {
    const filas = filasContratos(equipos, frecuencias);
    expect(hayClientesSinFrecuencia(filas)).toBe(true);
    expect(hayClientesSinFrecuencia(filas.filter((f) => f.meses !== null))).toBe(false);
    expect(textoContadorContratos(filas, filas)).toBe('3 clientes · 2 sin frecuencia');
    expect(textoContadorContratos(filas.slice(0, 1), filas)).toBe('1 de 3 clientes · 2 sin frecuencia');
    expect(textoContadorContratos(filas.slice(2), filas.slice(2))).toBe('1 cliente · todos con frecuencia');
  });
});
