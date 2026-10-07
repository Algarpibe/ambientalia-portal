import { describe, it, expect } from 'vitest';
import { ETIQUETA_ROL_APP, PERMISOS, ROLES_APP, permisosDe, puede, resolverRol, type Permiso, type RolApp } from './roles.js';

// La matriz de permisos de la app, entera: cada rol × cada permiso. Lo que
// aquí no esté a `true` no se puede hacer, y el router lo comprueba con estos
// mismos nombres.

const S = true;
const N = false;
const MATRIZ: Record<Permiso, Record<RolApp, boolean>> = {
  //                          LECTOR  COMERCIAL  TECNICO  DIRECTOR_TECNICO
  'seguimiento.write': { LECTOR: N, COMERCIAL: S, TECNICO: S, DIRECTOR_TECNICO: S },
  'avisos.write': { LECTOR: N, COMERCIAL: S, TECNICO: N, DIRECTOR_TECNICO: S },
  'contactos.write': { LECTOR: N, COMERCIAL: S, TECNICO: N, DIRECTOR_TECNICO: S },
  'servicios.tipo.write': { LECTOR: N, COMERCIAL: N, TECNICO: S, DIRECTOR_TECNICO: S },
  importar: { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: S },
  'config.write': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: S },
  'agenda.asignar': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: S },
  'agenda.liberar': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: S },
  'agenda.reparto': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: S },
  'agenda.flujo': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: S },
  'calibraciones.write': { LECTOR: N, COMERCIAL: N, TECNICO: S, DIRECTOR_TECNICO: S },
  'roles.manage': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: N },
};

describe('roles y permisos: los nombres', () => {
  it('los cuatro roles, del que menos puede al que más', () => {
    expect([...ROLES_APP]).toEqual(['LECTOR', 'COMERCIAL', 'TECNICO', 'DIRECTOR_TECNICO']);
  });

  it('los doce permisos, con sus nombres estables (los de la agenda y calibraciones ya están)', () => {
    expect([...PERMISOS]).toEqual([
      'seguimiento.write',
      'avisos.write',
      'contactos.write',
      'servicios.tipo.write',
      'importar',
      'config.write',
      'agenda.asignar',
      'agenda.liberar',
      'agenda.reparto',
      'agenda.flujo',
      'calibraciones.write',
      'roles.manage',
    ]);
    expect(Object.keys(MATRIZ).sort()).toEqual([...PERMISOS].sort());
  });

  it('cada rol tiene su etiqueta en español', () => {
    expect(ETIQUETA_ROL_APP).toEqual({ LECTOR: 'Lector', COMERCIAL: 'Comercial', TECNICO: 'Técnico', DIRECTOR_TECNICO: 'Director Técnico' });
  });
});

describe('la matriz entera: cada rol × cada permiso', () => {
  const casos = PERMISOS.flatMap((permiso) => ROLES_APP.map((rol) => ({ rol, permiso, esperado: MATRIZ[permiso][rol] })));

  it('son 48 casos', () => {
    expect(casos).toHaveLength(48);
  });

  it.each(casos)('$rol · $permiso → $esperado', ({ rol, permiso, esperado }) => {
    expect(puede(rol, permiso)).toBe(esperado);
    expect(permisosDe(rol).includes(permiso)).toBe(esperado);
  });

  it('LECTOR no puede nada', () => {
    expect(permisosDe('LECTOR')).toEqual([]);
  });

  it('el Director Técnico puede todo lo de Comercial y lo de Técnico', () => {
    for (const p of [...permisosDe('COMERCIAL'), ...permisosDe('TECNICO')]) expect(puede('DIRECTOR_TECNICO', p)).toBe(true);
  });

  it('ningún rol gestiona roles: eso es de los administradores del portal', () => {
    for (const rol of ROLES_APP) expect(puede(rol, 'roles.manage')).toBe(false);
  });
});

describe('administradores del portal', () => {
  it.each([...ROLES_APP])('un administrador tiene todos los permisos, tenga el rol %s o ninguno', (rol) => {
    for (const p of PERMISOS) expect(puede(rol, p, true)).toBe(true);
    expect(permisosDe(rol, true)).toEqual([...PERMISOS]);
  });

  it('permisosDe devuelve los permisos en el orden de PERMISOS y una copia cada vez', () => {
    expect(permisosDe('COMERCIAL')).toEqual(['seguimiento.write', 'avisos.write', 'contactos.write']);
    expect(permisosDe('TECNICO')).toEqual(['seguimiento.write', 'servicios.tipo.write', 'calibraciones.write']);
    const a = permisosDe('DIRECTOR_TECNICO');
    a.length = 0;
    expect(permisosDe('DIRECTOR_TECNICO')).toHaveLength(PERMISOS.length - 1);
  });
});

describe('resolverRol', () => {
  it('sin fila (o sin valor) es LECTOR', () => {
    expect(resolverRol(null)).toBe('LECTOR');
    expect(resolverRol(undefined)).toBe('LECTOR');
    expect(resolverRol('')).toBe('LECTOR');
  });

  it('conserva un rol conocido', () => {
    for (const r of ROLES_APP) expect(resolverRol(r)).toBe(r);
  });

  it.each(['ADMIN', 'admin', 'director_tecnico', ' TECNICO', 'constructor', 'toString'])('un valor desconocido (%j) cae al rol que menos puede', (v) => {
    expect(resolverRol(v)).toBe('LECTOR');
  });
});
