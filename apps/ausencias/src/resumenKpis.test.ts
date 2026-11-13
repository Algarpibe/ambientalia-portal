import { describe, it, expect } from 'vitest';
import { celdaDeDias, celdaDePermisos, rotuloDelPeriodo } from './resumenKpis';

describe('celdaDePermisos', () => {
  it('solo horas, solo días, las dos cosas o nada', () => {
    expect(celdaDePermisos(2.5, 0)).toBe('2,5 h');
    expect(celdaDePermisos(0, 2)).toBe('2 d');
    expect(celdaDePermisos(6.5, 1)).toBe('6,5 h + 1 d');
    expect(celdaDePermisos(0, 0)).toBe('—');
  });
});

describe('celdaDeDias', () => {
  it('el número con coma decimal, o «—» si es cero', () => {
    expect(celdaDeDias(12)).toBe('12');
    expect(celdaDeDias(0.5)).toBe('0,5');
    expect(celdaDeDias(0)).toBe('—');
  });
});

describe('rotuloDelPeriodo', () => {
  it('el año elegido o la ventana móvil', () => {
    expect(rotuloDelPeriodo(2025)).toBe('en 2025');
    expect(rotuloDelPeriodo(null)).toBe('en los últimos 12 meses');
  });
});
