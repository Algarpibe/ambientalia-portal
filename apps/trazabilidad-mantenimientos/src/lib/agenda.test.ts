import { describe, it, expect } from 'vitest';
import { CATEGORIAS_AGENDA, type DuracionAgendaConfig, type EstadoDesk, type PlazoServicio } from '../dominio';
import {
  OPCIONES_CATEGORIA,
  avisoCategoria,
  celdaDuracion,
  columnasDuraciones,
  estadosAgenda,
  firma,
  leerEntero,
  sinCategoria,
  ticketsPorEtapa,
} from './agenda';

// Lote 6 de la agenda del taller: lo que la pantalla de configuración calcula
// antes de pintar. Datos ficticios.

const estado = (etiqueta: string, ticketsAbiertos: number, categoria: EstadoDesk['categoria'], etapa: EstadoDesk['etapa'] = null): EstadoDesk => ({
  clave: etiqueta.toLowerCase(),
  etiqueta,
  tipoDesk: 'Open',
  ticketsAbiertos,
  rol: 'cuenta',
  actualizadoPor: null,
  actualizadoEn: null,
  categoria,
  etapa,
  categoriaPor: categoria ? 'semilla (migracion 050)' : null,
  categoriaEn: categoria ? '2026-10-06 15:00:00+00' : null,
});

const ESTADOS = [
  estado('Rev./Diagnostico', 4, 'activa', 'diagnostico'),
  estado('Ingresado', 2, 'entrada'),
  estado('Notificado', 1, 'activa', 'diagnostico'),
  estado('En Proceso', 3, 'activa', 'proceso'),
  estado('Estado Nuevo', 1, null),
  estado('Verificación', 0, 'activa', 'verificacion'),
  estado('Pendiente', 0, 'fuera'),
  estado('Otro Sin Nada', 0, null),
];

describe('tickets de cada etapa', () => {
  it('suma los abiertos de los estados de la etapa; lo que no es etapa activa no cuenta', () => {
    expect(ticketsPorEtapa(ESTADOS)).toEqual({ diagnostico: 5, proceso: 3, verificacion: 0 });
    expect(ticketsPorEtapa([])).toEqual({ diagnostico: 0, proceso: 0, verificacion: 0 });
  });
});

describe('estados de la tabla de categorías', () => {
  it('los que no tienen categoría salen arriba; el resto conserva el orden del servidor', () => {
    expect(estadosAgenda(ESTADOS, false).map((e) => e.etiqueta)).toEqual(['Estado Nuevo', 'Otro Sin Nada', 'Rev./Diagnostico', 'Ingresado', 'Notificado', 'En Proceso', 'Verificación', 'Pendiente']);
  });

  it('«sólo estados con tickets» quita los vacíos, pero nunca uno sin categoría: hay que poder dársela', () => {
    expect(estadosAgenda(ESTADOS, true).map((e) => e.etiqueta)).toEqual(['Estado Nuevo', 'Otro Sin Nada', 'Rev./Diagnostico', 'Ingresado', 'Notificado', 'En Proceso']);
  });

  it('los que no tienen categoría, para el aviso', () => {
    expect(sinCategoria(ESTADOS).map((e) => e.etiqueta)).toEqual(['Estado Nuevo', 'Otro Sin Nada']);
    expect(sinCategoria(ESTADOS.filter((e) => e.categoria))).toEqual([]);
  });

  it('una opción por categoría, en su orden, con su ayuda', () => {
    expect(OPCIONES_CATEGORIA.map((o) => o.valor)).toEqual([...CATEGORIAS_AGENDA]);
    expect(OPCIONES_CATEGORIA.map((o) => o.texto)).toEqual(['Por llegar', 'Fila de entrada', 'Etapa activa', 'Standby', 'Fin de taller', 'Fuera de la agenda']);
    for (const o of OPCIONES_CATEGORIA) expect(o.ayuda).toBeTruthy();
  });

  it('el aviso al guardar dice la categoría y, si es activa, la etapa', () => {
    expect(avisoCategoria('Notificado', 'activa', 'diagnostico')).toBe('Notificado: etapa activa · Diagnóstico');
    expect(avisoCategoria('Por Facturar', 'fin', null)).toBe('Por Facturar: fin de taller');
  });
});

describe('tabla de duraciones', () => {
  const plazo = (clave: string, etiqueta: string): PlazoServicio => ({ clave, etiqueta, dias: null, derivadoDe: null, ticketsAbiertos: 0, actualizadoPor: null, actualizadoEn: null });
  const PLAZOS = [plazo('diagnostico', 'Diagnóstico'), plazo('calibracion', 'Calibración')];
  const d = (etapa: DuracionAgendaConfig['etapa'], tipo: string, dias: number, por: string | null = null): DuracionAgendaConfig => ({ etapa, tipo, dias, actualizadoPor: por, actualizadoEn: por ? '2026-10-07 01:10:00+00' : null });
  const DURACIONES = [d('diagnostico', '*', 3), d('diagnostico', 'calibracion', 2, 'director@example.com'), d('proceso', '*', 4), d('proceso', 'tipo retirado', 9)];

  it('columnas: la «*», los tipos de los plazos, los que traen los tickets abiertos y los que ya tienen una duración, sin repetir', () => {
    const tipos = [
      { clave: 'calibracion', etiqueta: 'calibracion', tickets: 2 },
      { clave: 'garantia extendida', etiqueta: 'Garantía Extendida', tickets: 1 },
    ];
    expect(columnasDuraciones(PLAZOS, tipos, DURACIONES)).toEqual([
      { tipo: '*', etiqueta: '*', nota: 'Por defecto: vale para todo tipo sin duración propia, y para los tickets sin tipo.' },
      { tipo: 'diagnostico', etiqueta: 'Diagnóstico', nota: '' },
      { tipo: 'calibracion', etiqueta: 'Calibración', nota: '' },
      { tipo: 'garantia extendida', etiqueta: 'Garantía Extendida', nota: 'Lo traen los tickets abiertos; no tiene plazo configurado.' },
      { tipo: 'tipo retirado', etiqueta: 'tipo retirado', nota: 'Ya no está entre los tipos de servicio: vacía la casilla para quitarlo.' },
    ]);
  });

  it('sin nada más que lo sembrado, sólo la «*»', () => {
    expect(columnasDuraciones([], [], [d('diagnostico', '*', 3)]).map((c) => c.tipo)).toEqual(['*']);
  });

  it('una casilla: su valor propio o, vacía, el que hereda de la «*» de su etapa', () => {
    expect(celdaDuracion(DURACIONES, 'diagnostico', 'calibracion')).toEqual({ propia: DURACIONES[1], heredada: 3 });
    expect(celdaDuracion(DURACIONES, 'diagnostico', 'diagnostico')).toEqual({ propia: null, heredada: 3 });
    expect(celdaDuracion(DURACIONES, 'proceso', 'calibracion')).toEqual({ propia: null, heredada: 4 });
    // La «*» no hereda de nadie; una etapa sin «*» (sólo por SQL) no tiene qué heredar.
    expect(celdaDuracion(DURACIONES, 'proceso', '*')).toEqual({ propia: DURACIONES[2], heredada: null });
    expect(celdaDuracion(DURACIONES, 'verificacion', 'calibracion')).toEqual({ propia: null, heredada: null });
  });
});

describe('lo escrito en una casilla', () => {
  const PUESTOS = { min: 0, max: 50, vacio: false };
  const DIAS = { min: 1, max: 365, vacio: true };

  it('un entero dentro del rango vale', () => {
    expect(leerEntero('0', PUESTOS)).toEqual({ valor: 0 });
    expect(leerEntero(' 50 ', PUESTOS)).toEqual({ valor: 50 });
    expect(leerEntero('365', DIAS)).toEqual({ valor: 365 });
  });

  it('vacío vale sólo donde se puede quitar (una duración de tipo; no los puestos ni la «*»)', () => {
    expect(leerEntero('  ', DIAS)).toEqual({ valor: null });
    expect(leerEntero('', PUESTOS)).toEqual({ error: 'Un número entero entre 0 y 50.' });
    expect(leerEntero('', { ...DIAS, vacio: false })).toEqual({ error: 'Un número entero entre 1 y 365.' });
  });

  it('fuera del rango, con decimales o con letras no vale', () => {
    expect(leerEntero('51', PUESTOS)).toEqual({ error: 'Un número entero entre 0 y 50.' });
    expect(leerEntero('-1', PUESTOS)).toEqual({ error: 'Un número entero entre 0 y 50.' });
    expect(leerEntero('0', DIAS)).toEqual({ error: 'Un número entero entre 1 y 365, o vacío.' });
    expect(leerEntero('2.5', DIAS)).toEqual({ error: 'Un número entero entre 1 y 365, o vacío.' });
    expect(leerEntero('tres', DIAS)).toEqual({ error: 'Un número entero entre 1 y 365, o vacío.' });
  });
});

describe('firma de un cambio', () => {
  it('quién y cuándo, en hora de Colombia', () => {
    expect(firma('director@example.com', '2026-10-07 01:10:00+00')).toBe('director@example.com · 06/10/2026 20:10');
  });

  it('lo que puso la migración es «semilla»; lo que nadie ha tocado, «valor inicial»', () => {
    expect(firma('semilla (migracion 050)', '2026-10-06 15:00:00+00')).toBe('semilla');
    expect(firma(null, null)).toBe('valor inicial');
    expect(firma(null, null, 'propuesta')).toBe('propuesta');
  });
});
