import { describe, it, expect } from 'vitest';
import type { Prospecto } from './prospects';
import type { CruceZoho, HechosZoho } from './clientes';
import {
  ESTADOS_CLIENTE,
  ETIQUETA_ESTADO_CLIENTE,
  estadoCliente,
  filtrarPorCliente,
  hechosDe,
  nitBase,
  nitsParaConsultar,
} from './clientes';

// Hoy − 36 meses = 2023-11-26.
const HOY = '2026-11-26';

// NIT y fechas ficticios: el repo es público.
const hechos = (over: Partial<HechosZoho> = {}): HechosZoho => ({
  ultimaFactura: null,
  ocmaVendido: null,
  ultimosRepuestos: null,
  ...over,
});

const prospecto = (over: Partial<Prospecto> = {}): Prospecto => ({
  codigo: '101',
  nombre: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
  nit: '900.000.001-7',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  contacto: '',
  telefono: '',
  correo: '',
  matrices: ['Agua'],
  metodos: ['SM 5520 B'],
  grupo: 'gravimetria',
  vigenciaMasProxima: null,
  ...over,
});

const cruce = (entradas: Record<string, HechosZoho>): CruceZoho => new Map(Object.entries(entradas));

describe('nitBase', () => {
  it('el formato del dataset da el NIT de Zoho', () => {
    expect(nitBase('900.000.001-7')).toBe('900000001');
  });

  it('vacío, de relleno o de más de 10 dígitos da null', () => {
    expect(nitBase('')).toBeNull();
    expect(nitBase('123')).toBeNull();
    expect(nitBase('12345678901')).toBeNull();
  });
});

describe('estadoCliente', () => {
  it('sin NIT', () => {
    expect(estadoCliente('', cruce({}), HOY)).toBe('sin-nit');
  });

  it('no está en Zoho', () => {
    expect(estadoCliente('900.000.001-7', cruce({}), HOY)).toBe('no-en-zoho');
  });

  it('en Zoho sin compras', () => {
    expect(estadoCliente('900.000.001-7', cruce({ '900000001': hechos() }), HOY)).toBe('sin-compras');
  });

  it('activo justo en el límite de 36 meses, y antiguo el día anterior', () => {
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2023-11-26' }) }), HOY)).toBe('activo');
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2023-11-25' }) }), HOY)).toBe('antiguo');
  });

  it('activo con una factura reciente', () => {
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2026-10-01' }) }), HOY)).toBe('activo');
  });

  it('con hoy a 29 de febrero, el límite es el último día de febrero de hace 3 años', () => {
    const hoy = '2028-02-29';
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2025-02-28' }) }), hoy)).toBe('activo');
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2025-02-27' }) }), hoy)).toBe('antiguo');
  });
});

describe('hechosDe', () => {
  it('busca por NIT base', () => {
    const h = hechos({ ocmaVendido: '2024-05-02' });
    expect(hechosDe('900.000.001-7', cruce({ '900000001': h }))).toBe(h);
  });

  it('null sin NIT o fuera de Zoho', () => {
    expect(hechosDe('', cruce({}))).toBeNull();
    expect(hechosDe('900000001', cruce({}))).toBeNull();
  });
});

describe('nitsParaConsultar', () => {
  it('NIT base sin repetir y ordenados; los que no valen no van', () => {
    const nits = nitsParaConsultar([
      prospecto({ nit: '900.000.002-5' }),
      prospecto({ nit: '900.000.001-7' }),
      prospecto({ nit: '900000001' }),
      prospecto({ nit: '' }),
    ]);
    expect(nits).toEqual(['900000001', '900000002']);
  });
});

describe('filtrarPorCliente', () => {
  const lista = [prospecto({ nit: '900.000.001-7', nombre: 'A' }), prospecto({ nit: '', nombre: 'B' })];
  const c = cruce({ '900000001': hechos({ ultimaFactura: '2026-10-01' }) });

  it('«Todos» devuelve la lista entera', () => {
    expect(filtrarPorCliente(lista, '', c, HOY)).toBe(lista);
  });

  it('sin cruce (cargando o con error) no filtra', () => {
    expect(filtrarPorCliente(lista, 'activo', null, HOY)).toBe(lista);
  });

  it('con un estado deja solo los de ese estado', () => {
    expect(filtrarPorCliente(lista, 'activo', c, HOY).map((p) => p.nombre)).toEqual(['A']);
    expect(filtrarPorCliente(lista, 'sin-nit', c, HOY).map((p) => p.nombre)).toEqual(['B']);
  });
});

describe('etiquetas', () => {
  it('cinco estados, cada uno con su etiqueta', () => {
    expect(ESTADOS_CLIENTE.map((e) => ETIQUETA_ESTADO_CLIENTE[e])).toEqual([
      'Cliente activo',
      'Cliente antiguo',
      'En Zoho sin compras',
      'No está en Zoho',
      'Sin NIT',
    ]);
  });
});
