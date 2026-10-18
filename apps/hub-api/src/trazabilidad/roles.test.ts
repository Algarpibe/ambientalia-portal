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
  'maestro.sincronizar': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: S },
  // Lote 9d-2b: retirar o reincorporar un equipo o una fila de la hoja. Sólo el Director Técnico (por defecto, revisable): el Técnico corrige fechas, no retira.
  'inventario.write': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: S },
  // Lote 9e: exportar la F-ST-022 a un .xlsx. No cambia nada, pero saca del portal la hoja entera: Comercial, Técnico y Director Técnico (por defecto, revisable); el Lector no.
  'hoja.exportar': { LECTOR: N, COMERCIAL: S, TECNICO: S, DIRECTOR_TECNICO: S },
  // Lote 12: la frecuencia de preventivo de un cliente. Decisión de Alfonso: sólo el administrador del portal, así que de ningún rol.
  'contrato.write': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: N },
  'roles.manage': { LECTOR: N, COMERCIAL: N, TECNICO: N, DIRECTOR_TECNICO: N },
};

describe('roles y permisos: los nombres', () => {
  it('los cuatro roles, del que menos puede al que más', () => {
    expect([...ROLES_APP]).toEqual(['LECTOR', 'COMERCIAL', 'TECNICO', 'DIRECTOR_TECNICO']);
  });

  it('los dieciséis permisos, con sus nombres estables (los de la agenda y calibraciones ya están; el del maestro de equipos llegó con el lote 9b, el de retirar con el 9d-2b, el de exportar con el 9e y el de la frecuencia de contrato con el 12)', () => {
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
      'maestro.sincronizar',
      'inventario.write',
      'hoja.exportar',
      'contrato.write',
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

  it('son 64 casos', () => {
    expect(casos).toHaveLength(64);
  });

  it('exportar la F-ST-022 es de Comercial, Técnico y Director Técnico; el Lector la ve en pantalla y no se la lleva', () => {
    expect(ROLES_APP.filter((rol) => puede(rol, 'hoja.exportar'))).toEqual(['COMERCIAL', 'TECNICO', 'DIRECTOR_TECNICO']);
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

  it('ningún rol rellena la frecuencia de preventivo de un cliente (lote 12): sólo el administrador del portal', () => {
    for (const rol of ROLES_APP) expect(puede(rol, 'contrato.write')).toBe(false);
    expect(puede('LECTOR', 'contrato.write', true)).toBe(true);
  });
});

describe('administradores del portal', () => {
  it.each([...ROLES_APP])('un administrador tiene todos los permisos, tenga el rol %s o ninguno', (rol) => {
    for (const p of PERMISOS) expect(puede(rol, p, true)).toBe(true);
    expect(permisosDe(rol, true)).toEqual([...PERMISOS]);
  });

  it('permisosDe devuelve los permisos en el orden de PERMISOS y una copia cada vez', () => {
    expect(permisosDe('COMERCIAL')).toEqual(['seguimiento.write', 'avisos.write', 'contactos.write', 'hoja.exportar']);
    expect(permisosDe('TECNICO')).toEqual(['seguimiento.write', 'servicios.tipo.write', 'calibraciones.write', 'hoja.exportar']);
    const a = permisosDe('DIRECTOR_TECNICO');
    a.length = 0;
    expect(permisosDe('DIRECTOR_TECNICO')).toHaveLength(PERMISOS.length - 2); // ni roles.manage ni contrato.write: los dos, sólo de administradores del portal
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
