import { describe, it, expect } from 'vitest';
import { destinoTrasLogin } from './destinoTrasLogin';

// A dónde se vuelve tras iniciar sesión (spec 2026-11-20, §5.2): a la ruta
// protegida de la que se llegó, solo si es interna; si no, al inicio.

describe('destinoTrasLogin', () => {
  it.each(['/contabilidad', '/ausencias/solicitudes', '/'])('una ruta interna (%s) se respeta', (from) => {
    expect(destinoTrasLogin({ from })).toBe(from);
  });

  it.each([
    ['sin state', undefined],
    ['con state null', null],
    ['sin from', {}],
    ['con un from que no es texto', { from: 42 }],
    ['con un from vacío', { from: '' }],
    ['relativa al protocolo (//)', { from: '//evil.test' }],
    ['absoluta', { from: 'https://evil.test/' }],
    ['con barra invertida', { from: '/\\evil.test' }],
    ['javascript:', { from: 'javascript:alert(1)' }],
    ['sin barra inicial', { from: 'contabilidad' }],
    ['con un tabulador que el navegador quitaría', { from: '/\t/evil.test' }],
  ])('%s → al inicio', (_caso, state) => {
    expect(destinoTrasLogin(state)).toBe('/');
  });
});
