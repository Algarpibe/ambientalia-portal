import { describe, it, expect } from 'vitest';
import { fechaConMes, textoDeDescanso } from './descanso';

const f = (tramo: 'nunca' | 'alarma' | 'aviso' | 'ok' | 'ahora', dias: number | null, meses: number | null) => ({
  tramo,
  diasSinVacaciones: dias,
  mesesSinVacaciones: meses,
});

describe('textoDeDescanso', () => {
  it('de vacaciones ahora y sin vacaciones registradas', () => {
    expect(textoDeDescanso(f('ahora', 200, 6))).toBe('de vacaciones ahora');
    expect(textoDeDescanso(f('nunca', null, null))).toBe('sin vacaciones registradas');
  });

  it('en días por debajo de 60', () => {
    expect(textoDeDescanso(f('ok', 1, 0))).toBe('hace 1 día');
    expect(textoDeDescanso(f('ok', 34, 1))).toBe('hace 34 días');
  });

  it('CANDADO: en meses desde 60 días, con los meses que manda el servidor', () => {
    expect(textoDeDescanso(f('ok', 60, 1))).toBe('hace 1 mes');
    expect(textoDeDescanso(f('alarma', 365, 12))).toBe('hace 12 meses');
    expect(textoDeDescanso(f('alarma', 700, 23))).toBe('hace 23 meses');
  });

  it('en años desde 24 meses', () => {
    expect(textoDeDescanso(f('alarma', 760, 24))).toBe('hace 2 años');
  });
});

describe('fechaConMes', () => {
  it('YYYY-MM-DD a «3 oct 2026»', () => {
    expect(fechaConMes('2026-10-03')).toBe('3 oct 2026');
    expect(fechaConMes('2025-01-15')).toBe('15 ene 2025');
  });
});
