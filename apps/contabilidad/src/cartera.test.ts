import { describe, it, expect } from 'vitest';
import { diasEnCartera, hoyLocal } from './cartera';

describe('diasEnCartera', () => {
  const pendiente = (fechaVencimiento: string) => ({ porCobrar: 1000, fechaVencimiento });

  it('vencida: días positivos (hoy − vencimiento)', () => {
    expect(diasEnCartera(pendiente('2026-09-27'), '2026-11-11')).toBe(45);
  });

  it('por vencer: días negativos', () => {
    expect(diasEnCartera(pendiente('2026-11-21'), '2026-11-11')).toBe(-10);
  });

  it('vence hoy: 0', () => {
    expect(diasEnCartera(pendiente('2026-11-11'), '2026-11-11')).toBe(0);
  });

  it('cruza años sin descuadrarse', () => {
    expect(diasEnCartera(pendiente('2025-12-31'), '2026-01-01')).toBe(1);
  });

  it('pagada (sin saldo): null', () => {
    expect(diasEnCartera({ porCobrar: 0, fechaVencimiento: '2026-01-01' }, '2026-11-11')).toBeNull();
  });

  it('sin fecha de vencimiento o con una ilegible: null', () => {
    expect(diasEnCartera(pendiente(''), '2026-11-11')).toBeNull();
    expect(diasEnCartera(pendiente('no-es-fecha'), '2026-11-11')).toBeNull();
  });
});

describe('hoyLocal', () => {
  it('usa la fecha local, no la UTC (a las 23:30 sigue siendo el mismo día)', () => {
    expect(hoyLocal(new Date(2026, 10, 11, 23, 30))).toBe('2026-11-11');
  });

  it('rellena mes y día con cero', () => {
    expect(hoyLocal(new Date(2026, 0, 5, 8, 0))).toBe('2026-01-05');
  });
});
