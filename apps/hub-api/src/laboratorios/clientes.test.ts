import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import {
  CATEGORIA_OCMA,
  CATEGORIA_REPUESTOS_OCMA,
  agruparPorNit,
  leerHechosZoho,
  nitBase,
  type FilaContacto,
} from './clientes.js';

// NIT y fechas ficticios: el repo es público.
const fila = (over: Partial<FilaContacto> = {}): FilaContacto => ({
  nit: '900000001',
  ultima_factura: null,
  ocma_vendido: null,
  ultimos_repuestos: null,
  ...over,
});

describe('nitBase', () => {
  it('quita puntos y el dígito de verificación', () => {
    expect(nitBase('900.000.001-7')).toBe('900000001');
  });

  it('deja igual un NIT que ya viene solo con dígitos', () => {
    expect(nitBase('900000001')).toBe('900000001');
  });

  it('quita espacios', () => {
    expect(nitBase(' 900 000 001 ')).toBe('900000001');
  });

  it('ignora los de relleno (menos de 6 dígitos) y los de más de 10', () => {
    expect(nitBase('0')).toBeNull();
    expect(nitBase('12345')).toBeNull();
    expect(nitBase('12345678901')).toBeNull();
  });

  it('acepta los bordes de 6 y 10 dígitos', () => {
    expect(nitBase('123456')).toBe('123456');
    expect(nitBase('1234567890')).toBe('1234567890');
  });

  it('null, vacío o sin dígitos dan null', () => {
    expect(nitBase(null)).toBeNull();
    expect(nitBase('')).toBeNull();
    expect(nitBase('N/A')).toBeNull();
  });
});

describe('agruparPorNit', () => {
  it('un contacto da sus tres fechas', () => {
    const mapa = agruparPorNit([
      fila({ ultima_factura: '2026-03-10', ocma_vendido: '2024-05-02', ultimos_repuestos: '2026-01-15' }),
    ]);
    expect(mapa.get('900000001')).toEqual({
      ultimaFactura: '2026-03-10',
      ocmaVendido: '2024-05-02',
      ultimosRepuestos: '2026-01-15',
    });
  });

  it('dos contactos con el mismo NIT base se quedan con la fecha más reciente de cada tipo', () => {
    const mapa = agruparPorNit([
      fila({ nit: '900000001', ultima_factura: '2025-01-01', ocma_vendido: '2024-05-02', ultimos_repuestos: null }),
      fila({ nit: '900.000.001-7', ultima_factura: '2026-03-10', ocma_vendido: null, ultimos_repuestos: '2025-08-20' }),
    ]);
    expect(mapa.size).toBe(1);
    expect(mapa.get('900000001')).toEqual({
      ultimaFactura: '2026-03-10',
      ocmaVendido: '2024-05-02',
      ultimosRepuestos: '2025-08-20',
    });
  });

  it('un contacto sin facturas está en el mapa con las tres fechas a null', () => {
    expect(agruparPorNit([fila()]).get('900000001')).toEqual({
      ultimaFactura: null,
      ocmaVendido: null,
      ultimosRepuestos: null,
    });
  });

  it('los NIT de relleno o vacíos no aparecen', () => {
    const mapa = agruparPorNit([fila({ nit: '0', ultima_factura: '2026-01-01' }), fila({ nit: null })]);
    expect(mapa.size).toBe(0);
  });
});

describe('leerHechosZoho', () => {
  it('consulta la réplica con las dos categorías como parámetros y agrega las filas', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [fila({ nit: '900.000.001-7', ultima_factura: '2026-03-10' })],
    });
    const mapa = await leerHechosZoho({ query } as unknown as Pool);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('books.contacts');
    expect(params).toEqual([CATEGORIA_OCMA, CATEGORIA_REPUESTOS_OCMA]);
    expect(mapa.get('900000001')?.ultimaFactura).toBe('2026-03-10');
  });

  it('las categorías son las de Zoho', () => {
    expect(CATEGORIA_OCMA).toBe('OCMA-500 Series');
    expect(CATEGORIA_REPUESTOS_OCMA).toBe('C&R OCMA-500');
  });
});
