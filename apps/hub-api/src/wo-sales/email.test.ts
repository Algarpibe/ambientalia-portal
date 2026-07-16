import { describe, it, expect } from 'vitest';
import { hashMatriz, construirCuerpo, decidirEnvio } from './email.js';
import { DEFAULT_CONFIG } from './config.js';

describe('hashMatriz', () => {
  it('la misma matriz da el mismo hash (estable)', () => {
    const m = [['a', 'b'], ['1', '2']];
    expect(hashMatriz(m)).toBe(hashMatriz([['a', 'b'], ['1', '2']]));
  });
  it('una celda distinta cambia el hash', () => {
    expect(hashMatriz([['a', 'b'], ['1', '2']])).not.toBe(hashMatriz([['a', 'b'], ['1', '3']]));
  });
  it('una fila de menos (OV que sale) cambia el hash', () => {
    expect(hashMatriz([['a'], ['1'], ['2']])).not.toBe(hashMatriz([['a'], ['1']]));
  });
});

describe('decidirEnvio', () => {
  it('sin_cambios cuando el hash coincide con el último enviado', () => {
    expect(decidirEnvio('abc', 'abc', true)).toBe('sin_cambios');
  });
  it('enviar cuando el hash cambió y hay destinatarios', () => {
    expect(decidirEnvio('abc', 'viejo', true)).toBe('enviar');
  });
  it('sin_destinatarios cuando cambió pero no hay a quién enviar', () => {
    expect(decidirEnvio('abc', 'viejo', false)).toBe('sin_destinatarios');
  });
  it('sin_cambios manda sobre la falta de destinatarios (no hay nada que enviar)', () => {
    expect(decidirEnvio('abc', 'abc', false)).toBe('sin_cambios');
  });
});

describe('construirCuerpo', () => {
  it('incluye el asunto, los totales y las OV cambiadas', () => {
    const cuerpo = construirCuerpo(
      { ordenes: 3, filas: 7, cambiadas: ['OV-2026-138', 'OV-2026-077'], advertencias: 0 },
      DEFAULT_CONFIG
    );
    expect(cuerpo).toContain('Nueva actualización de MovimientoInventarioWO');
    expect(cuerpo).toContain('3');
    expect(cuerpo).toContain('7');
    expect(cuerpo).toContain('OV-2026-138');
  });
  it('menciona las advertencias solo si las hay', () => {
    const con = construirCuerpo({ ordenes: 1, filas: 1, cambiadas: [], advertencias: 5 }, DEFAULT_CONFIG);
    expect(con).toContain('5');
    const sin = construirCuerpo({ ordenes: 1, filas: 1, cambiadas: [], advertencias: 0 }, DEFAULT_CONFIG);
    expect(sin.toLowerCase()).not.toContain('advertencia');
  });
});
