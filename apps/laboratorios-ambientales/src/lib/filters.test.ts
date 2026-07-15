import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { EMPTY_FILTERS } from '../types';
import { applyFilters, optionsFor, clearDownstream } from './filters';

const lab = (over: Partial<Laboratorio>): Laboratorio => ({
  codigo: '1', estado: 'Activa', matriz: 'Agua', componente: 'Continental',
  actividad: 'Análisis', grupo: 'Fisicoquímicos', variable: 'pH', tecnica: 'Electrometría',
  metodo: 'SM 4500', rango: '', nombreLaboratorio: 'Lab Uno', nit: '', contacto: '',
  ciudad: 'Medellín', departamento: 'Antioquia', direccion: '', telefono: '', correo: '',
  actoAdministrativo: '', desde: '', hasta: '', ...over,
});

const DATA: Laboratorio[] = [
  lab({ matriz: 'Agua', componente: 'Continental', variable: 'pH', metodo: 'SM 4500' }),
  lab({ matriz: 'Agua', componente: 'Continental', variable: 'Alcalinidad', metodo: 'SM 2320 B' }),
  lab({ matriz: 'Aire', componente: 'Calidad del Aire', variable: 'PM10', metodo: 'EQPM-0798-122', nombreLaboratorio: 'Lab Dos' }),
  lab({ matriz: 'Aire', componente: 'Fuentes Fijas', variable: 'SO2', metodo: 'M6', estado: 'Suspendida' }),
];

describe('applyFilters', () => {
  it('sin filtros devuelve todo', () => {
    expect(applyFilters(DATA, EMPTY_FILTERS)).toHaveLength(4);
  });

  it('busca por nombre de laboratorio y por variable', () => {
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, busqueda: 'lab dos' })).toHaveLength(1);
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, busqueda: 'alcalinidad' })).toHaveLength(1);
  });

  it('la búsqueda es insensible a mayúsculas y recorta espacios', () => {
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, busqueda: '  PM10 ' })).toHaveLength(1);
  });

  it('filtra por estado con los valores reales', () => {
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, estado: 'Activa' })).toHaveLength(3);
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, estado: 'Suspendida' })).toHaveLength(1);
  });

  it('combina filtros en conjunción', () => {
    const res = applyFilters(DATA, { ...EMPTY_FILTERS, matriz: 'Aire', estado: 'Activa' });
    expect(res).toHaveLength(1);
    expect(res[0].variable).toBe('PM10');
  });

  it('trata variables como un OR entre las seleccionadas', () => {
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, variables: ['pH', 'PM10'] })).toHaveLength(2);
  });
});

describe('optionsFor', () => {
  it('acota componente a la matriz elegida', () => {
    expect(optionsFor(DATA, 'componente', { ...EMPTY_FILTERS, matriz: 'Agua' })).toEqual(['Continental']);
    expect(optionsFor(DATA, 'componente', { ...EMPTY_FILTERS, matriz: 'Aire' })).toEqual(['Calidad del Aire', 'Fuentes Fijas']);
  });

  it('sin filtros aguas arriba ofrece todas las opciones, ordenadas y sin repetir', () => {
    expect(optionsFor(DATA, 'componente', EMPTY_FILTERS)).toEqual(['Calidad del Aire', 'Continental', 'Fuentes Fijas']);
  });

  it('acota variable a matriz + componente', () => {
    const filters = { ...EMPTY_FILTERS, matriz: 'Agua', componente: 'Continental' };
    expect(optionsFor(DATA, 'variable', filters)).toEqual(['Alcalinidad', 'pH']);
  });

  it('acota método por las variables seleccionadas', () => {
    const filters = { ...EMPTY_FILTERS, matriz: 'Agua', variables: ['Alcalinidad'] };
    expect(optionsFor(DATA, 'metodo', filters)).toEqual(['SM 2320 B']);
  });

  it('el estado también acota, aunque no esté en la cascada', () => {
    expect(optionsFor(DATA, 'componente', { ...EMPTY_FILTERS, matriz: 'Aire', estado: 'Activa' })).toEqual(['Calidad del Aire']);
  });

  it('ignora el propio filtro del campo al calcular sus opciones', () => {
    const filters = { ...EMPTY_FILTERS, matriz: 'Aire', componente: 'Calidad del Aire' };
    expect(optionsFor(DATA, 'componente', filters)).toEqual(['Calidad del Aire', 'Fuentes Fijas']);
  });

  it('acota matriz por estado: no ofrece matrices sin registros en ese estado', () => {
    const soloSuspendida: Laboratorio[] = [
      lab({ matriz: 'Agua', estado: 'Activa' }),
      lab({ matriz: 'Aire', estado: 'Activa' }),
      lab({ matriz: 'Lodo', estado: 'Suspendida' }),
    ];
    expect(optionsFor(soloSuspendida, 'matriz', { ...EMPTY_FILTERS, estado: 'Suspendida' })).toEqual(['Lodo']);
    expect(optionsFor(soloSuspendida, 'matriz', { ...EMPTY_FILTERS, estado: 'Activa' })).toEqual(['Agua', 'Aire']);
  });

  it('no acota matriz por sí misma: sigue ofreciendo todas para poder cambiar de opción', () => {
    const data: Laboratorio[] = [lab({ matriz: 'Agua' }), lab({ matriz: 'Aire' })];
    expect(optionsFor(data, 'matriz', { ...EMPTY_FILTERS, matriz: 'Agua' })).toEqual(['Agua', 'Aire']);
  });

  it('no acota matriz por los filtros de aguas abajo', () => {
    const data: Laboratorio[] = [
      lab({ matriz: 'Agua', componente: 'Continental' }),
      lab({ matriz: 'Aire', componente: 'Calidad del Aire' }),
    ];
    expect(optionsFor(data, 'matriz', { ...EMPTY_FILTERS, componente: 'Continental' })).toEqual(['Agua', 'Aire']);
  });
});

// El dataset trae 'variable' con grafías divergentes (994 crudas -> 888 reales,
// 99 grupos duplicados). No se normaliza al mapear porque title-case rompería
// los nombres técnicos (pH -> Ph, DQO -> Dqo), así que se resuelve aquí.
describe('optionsFor con variables de grafía divergente', () => {
  const DUPES: Laboratorio[] = [
    lab({ variable: 'Plomo' }), lab({ variable: 'Plomo' }), lab({ variable: 'plomo' }),
    lab({ variable: 'Sólidos Totales' }), lab({ variable: 'Sólidos totales' }), lab({ variable: 'Sólidos totales' }),
    lab({ variable: 'pH' }),
  ];

  it('no ofrece la misma variable dos veces por diferir en mayúsculas', () => {
    const opciones = optionsFor(DUPES, 'variable', EMPTY_FILTERS);
    expect(opciones).toHaveLength(3);
  });

  it('muestra como canónica la grafía más frecuente', () => {
    const opciones = optionsFor(DUPES, 'variable', EMPTY_FILTERS);
    expect(opciones).toContain('Plomo');           // 2 vs 1 de 'plomo'
    expect(opciones).toContain('Sólidos totales'); // 2 vs 1 de 'Sólidos Totales'
  });

  it('preserva la capitalización técnica: pH nunca se convierte en Ph', () => {
    expect(optionsFor(DUPES, 'variable', EMPTY_FILTERS)).toContain('pH');
  });

  it('seleccionar una grafía captura los registros de todas las demás', () => {
    expect(applyFilters(DUPES, { ...EMPTY_FILTERS, variables: ['Plomo'] })).toHaveLength(3);
    expect(applyFilters(DUPES, { ...EMPTY_FILTERS, variables: ['plomo'] })).toHaveLength(3);
  });

  // Sobre los datos reales son 3 grupos que solo difieren en un espacio doble
  // ('Coliformes Termotolerantes  (fecales)'), y son justo los que separan las
  // 891 opciones de las 888 reales. normalize.ts colapsa \s+ por este motivo.
  it('tampoco duplica por espacios internos de más', () => {
    const ESPACIOS: Laboratorio[] = [
      lab({ variable: 'Coliformes Termotolerantes (fecales)' }),
      lab({ variable: 'Coliformes Termotolerantes  (fecales)' }),
    ];
    expect(optionsFor(ESPACIOS, 'variable', EMPTY_FILTERS)).toHaveLength(1);
    // Y la opción ofrecida debe capturar las dos grafías, no solo la suya.
    const [opcion] = optionsFor(ESPACIOS, 'variable', EMPTY_FILTERS);
    expect(applyFilters(ESPACIOS, { ...EMPTY_FILTERS, variables: [opcion] })).toHaveLength(2);
  });
});

describe('clearDownstream', () => {
  const full = { busqueda: 'x', estado: 'Activa', matriz: 'Agua', componente: 'Continental', actividad: 'Análisis', variables: ['pH'], metodo: 'SM 4500' };

  it('cambiar matriz limpia todo lo que va debajo', () => {
    const next = clearDownstream(full, 'matriz');
    expect(next.componente).toBe('');
    expect(next.actividad).toBe('');
    expect(next.variables).toEqual([]);
    expect(next.metodo).toBe('');
  });

  it('cambiar actividad no toca matriz ni componente', () => {
    const next = clearDownstream(full, 'actividad');
    expect(next.matriz).toBe('Agua');
    expect(next.componente).toBe('Continental');
    expect(next.variables).toEqual([]);
    expect(next.metodo).toBe('');
  });

  it('no toca búsqueda ni estado, que están fuera de la cascada', () => {
    const next = clearDownstream(full, 'matriz');
    expect(next.busqueda).toBe('x');
    expect(next.estado).toBe('Activa');
  });
});
