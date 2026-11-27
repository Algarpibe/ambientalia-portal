import { describe, it, expect } from 'vitest';
import { completaLosBrindis } from './brindis';
import { BRUNO, CARLA } from './fixtures';

/** Falta un compañero: ya brindé por Carla y me queda Bruno. */
const faltaUno = { brindis: { dados: 1, minimo: 2 }, misVotos: { [CARLA]: ['Empatía'] } };

describe('completaLosBrindis', () => {
  it('es true al brindar por el último compañero que faltaba', () => {
    expect(completaLosBrindis(faltaUno, BRUNO, ['Compromiso'])).toBe(true);
  });

  it('es false si después todavía faltan', () => {
    expect(completaLosBrindis({ brindis: { dados: 0, minimo: 2 }, misVotos: {} }, BRUNO, ['Compromiso'])).toBe(false);
  });

  it('es false al cambiar el brindis de alguien por quien ya había brindado', () => {
    expect(completaLosBrindis(faltaUno, CARLA, ['Compromiso'])).toBe(false);
  });

  it('es false al retirar un brindis, con los brindis ya completos o sin nadie por quien brindar', () => {
    expect(completaLosBrindis(faltaUno, BRUNO, [])).toBe(false);
    expect(completaLosBrindis({ brindis: { dados: 2, minimo: 2 }, misVotos: {} }, BRUNO, ['Compromiso'])).toBe(false);
    expect(completaLosBrindis({ brindis: { dados: 0, minimo: 0 }, misVotos: {} }, BRUNO, ['Compromiso'])).toBe(false);
  });
});
