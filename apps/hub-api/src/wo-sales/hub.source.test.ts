import { describe, it, expect } from 'vitest';
import { pendientePorFacturar } from './hub.source.js';

// La cantidad que World Office debe cargar es la PENDIENTE de facturar, no la pedida:
// cargar lo ya facturado duplicaría inventario y facturación. Esta es la aritmética
// que lo decide; los números salen de OV-2026-077 real (cada línea: pedida 7, ya
// facturada 3 → pendiente 4).
describe('pendientePorFacturar', () => {
  it('descuenta lo ya facturado (OV-2026-077 real: 7 − 3 = 4)', () => {
    expect(pendientePorFacturar(7, 3, 0)).toEqual({ cantidad: 4, incluir: true });
  });

  it('una OV no facturada exporta la cantidad completa', () => {
    expect(pendientePorFacturar(50, 0, 0)).toEqual({ cantidad: 50, incluir: true });
  });

  it('una línea facturada del todo NO entra al archivo', () => {
    expect(pendientePorFacturar(7, 7, 0)).toEqual({ cantidad: 0, incluir: false });
  });

  it('también descuenta lo cancelado', () => {
    expect(pendientePorFacturar(10, 2, 3)).toEqual({ cantidad: 5, incluir: true });
  });

  it('un descuadre (facturada > pedida) no entra: no queda nada pendiente', () => {
    expect(pendientePorFacturar(5, 8, 0)).toEqual({ cantidad: -3, incluir: false });
  });

  it('NaN (dato corrupto) SÍ entra: no se descarta en silencio, lo cazará el builder', () => {
    const r = pendientePorFacturar(NaN, 0, 0);
    expect(Number.isNaN(r.cantidad)).toBe(true);
    expect(r.incluir).toBe(true);
  });
});
