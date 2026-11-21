import { describe, it, expect, beforeEach } from 'vitest';
import { guardarTerminos, leerTerminos, marcarTerminosAceptados, olvidarTerminos } from './terminosSesion';

// El estado de las condiciones de uso de la sesión: lo que dijo GET /api/users/me
// en su campo `terms`, por cuenta. Lógica pura, sin DOM.

beforeEach(() => olvidarTerminos());

describe('terminosSesion', () => {
  it('sin nada guardado no se sabe: null', () => {
    expect(leerTerminos('u1')).toBeNull();
  });

  it('guarda el terms de /users/me y lo devuelve para esa cuenta', () => {
    guardarTerminos('u1', { current: '1.0', accepted: false });
    expect(leerTerminos('u1')).toEqual({ current: '1.0', accepted: false });
  });

  it('lo de una cuenta no vale para otra, ni sin cuenta', () => {
    guardarTerminos('u1', { current: '1.0', accepted: false });
    expect(leerTerminos('u2')).toBeNull();
    expect(leerTerminos(null)).toBeNull();
  });

  it('al cambiar de cuenta en la misma pestaña, lo de la nueva sustituye a lo de la anterior', () => {
    guardarTerminos('u1', { current: '1.0', accepted: false });
    guardarTerminos('u2', { current: '1.0', accepted: true });
    expect(leerTerminos('u1')).toBeNull();
    expect(leerTerminos('u2')).toEqual({ current: '1.0', accepted: true });
  });

  it.each([
    ['ausente (hub-api anterior)', undefined],
    ['null', null],
    ['sin accepted', { current: '1.0' }],
    ['con accepted que no es booleano', { current: '1.0', accepted: 'no' }],
    ['con current que no es texto', { current: 1, accepted: false }],
    ['un texto suelto', 'aceptado'],
  ])('un terms %s no se guarda: sin dato no se pide nada', (_caso, valor) => {
    guardarTerminos('u1', valor);
    expect(leerTerminos('u1')).toBeNull();
  });

  it('marcarTerminosAceptados la da por aceptada sin tocar la versión', () => {
    guardarTerminos('u1', { current: '1.0', accepted: false });
    marcarTerminosAceptados('u1');
    expect(leerTerminos('u1')).toEqual({ current: '1.0', accepted: true });
  });

  it('marcar otra cuenta no cambia la guardada', () => {
    guardarTerminos('u1', { current: '1.0', accepted: false });
    marcarTerminosAceptados('u2');
    expect(leerTerminos('u1')).toEqual({ current: '1.0', accepted: false });
    expect(leerTerminos('u2')).toBeNull();
  });
});
