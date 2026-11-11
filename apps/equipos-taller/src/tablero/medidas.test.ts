// Presupuesto de espacio de la pantalla de TV: alto de cada tarjeta y densidad por columna. Puro, sin layout.
import { describe, expect, it } from 'vitest';
import { MEDIDAS, alturaTarjeta, planColumna } from './medidas';

const sinEtiquetas = (n: number, etiquetas = 0) => Array.from({ length: n }, () => ({ etiquetas }));

describe('alturaTarjeta()', () => {
  it('base + 38 px por etiqueta', () => {
    expect(alturaTarjeta(0)).toBe(MEDIDAS.base);
    expect(alturaTarjeta(1)).toBe(MEDIDAS.base + 38);
    expect(alturaTarjeta(3)).toBe(MEDIDAS.base + 114);
  });
});

describe('constantes del presupuesto (1920×1080)', () => {
  it('tablero 770, área de tarjetas ≈612, tarjeta base 189 y compacta ≈100', () => {
    expect(MEDIDAS.tablero).toBe(770);
    expect(MEDIDAS.areaTarjetas).toBe(612);
    expect(MEDIDAS.base).toBe(189);
    expect(MEDIDAS.compacta).toBe(100);
  });
});

describe('planColumna()', () => {
  it('caben 3 tarjetas completas: densidad completa, sin ocultas', () => {
    expect(planColumna(sinEtiquetas(3))).toEqual({ densidad: 'completa', visibles: 3, ocultas: 0 });
  });
  it('una columna vacía no oculta nada', () => {
    expect(planColumna([])).toEqual({ densidad: 'completa', visibles: 0, ocultas: 0 });
  });
  it('4 tarjetas ya no caben completas: pasan TODAS a compactas', () => {
    expect(planColumna(sinEtiquetas(4))).toEqual({ densidad: 'compacta', visibles: 4, ocultas: 0 });
  });
  it('las etiquetas cuentan: 2 tarjetas con 3 etiquetas no caben completas', () => {
    expect(planColumna(sinEtiquetas(2, 3))).toEqual({ densidad: 'compacta', visibles: 2, ocultas: 0 });
    expect(planColumna(sinEtiquetas(2, 0)).densidad).toBe('completa');
  });
  it('5 compactas caben; con 6 se muestran las más antiguas y «+N más» (nunca se pierden en silencio)', () => {
    expect(planColumna(sinEtiquetas(5))).toEqual({ densidad: 'compacta', visibles: 5, ocultas: 0 });
    const p = planColumna(sinEtiquetas(9));
    expect(p.densidad).toBe('compacta');
    expect(p.visibles).toBe(5);
    expect(p.ocultas).toBe(4);
    expect(p.visibles + p.ocultas).toBe(9);
  });
  it('lo visible más el «+N más» cabe en el área', () => {
    const p = planColumna(sinEtiquetas(30));
    const usado = p.visibles * MEDIDAS.compacta + p.visibles * MEDIDAS.hueco + MEDIDAS.mas;
    expect(usado).toBeLessThanOrEqual(MEDIDAS.areaTarjetas);
  });
});
