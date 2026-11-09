import { describe, it, expect } from 'vitest';
import { ordenarParaAsignar } from './documento-numero.js';

describe('ordenarParaAsignar', () => {
  it('ordena por año y consecutivo de la OV', () => {
    expect(ordenarParaAsignar(['OV-2026-213', 'OV-2025-199', 'OV-2026-212'])).toEqual([
      'OV-2025-199',
      'OV-2026-212',
      'OV-2026-213',
    ]);
  });

  it('compara el consecutivo como número, no como texto: la 999 va antes que la 1000', () => {
    expect(ordenarParaAsignar(['OV-2026-1000', 'OV-2026-999'])).toEqual(['OV-2026-999', 'OV-2026-1000']);
  });

  it('los números que no cumplen OV-AAAA-XXX van al final, en orden de texto', () => {
    expect(ordenarParaAsignar(['OV-2026-1000-01', 'OV-2026-005', 'ABC'])).toEqual([
      'OV-2026-005',
      'ABC',
      'OV-2026-1000-01',
    ]);
  });

  it('no modifica el arreglo que recibe', () => {
    const entrada = ['OV-2026-213', 'OV-2026-212'];
    ordenarParaAsignar(entrada);
    expect(entrada).toEqual(['OV-2026-213', 'OV-2026-212']);
  });
});
