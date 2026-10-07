import { describe, it, expect } from 'vitest';
import { PERMISOS, ROLES_APP, permisosDe, type MiRol, type RolApp } from '../dominio';
import { GRUPOS, SECCIONES, SIN_ROL, etiquetaMiRol, grupoDe, motivoSinPermiso, primeraSeccion, seccionDeHash, seccionesDe, tiene } from './navegacion';

const yo = (role: RolApp, admin = false): MiRol => ({ userId: 'u1', email: 'u1@example.com', role, admin, permissions: permisosDe(role, admin), canManageRoles: admin });

describe('navegación en dos niveles', () => {
  it('tres grupos, en este orden y con estos nombres', () => {
    expect(GRUPOS.map((g) => [g.id, g.label])).toEqual([
      ['clientes', 'Clientes y calibraciones'],
      ['taller', 'Taller'],
      ['administracion', 'Administración'],
    ]);
  });

  it('cada sección cuelga de su grupo', () => {
    expect(SECCIONES.map((s) => [s.grupo, s.id, s.label])).toEqual([
      ['clientes', 'resumen', 'Resumen'],
      ['clientes', 'equipos', 'Equipos'],
      ['clientes', 'calendario', 'Calendario Calibraciones'],
      ['clientes', 'avisos', 'Avisos a clientes'],
      ['taller', 'servicios', 'Servicios'],
      ['administracion', 'configuracion', 'Configuración'],
      ['administracion', 'roles', 'Roles'],
    ]);
  });

  it('grupoDe dice a qué grupo pertenece cada sección', () => {
    expect(grupoDe('resumen')).toBe('clientes');
    expect(grupoDe('avisos')).toBe('clientes');
    expect(grupoDe('servicios')).toBe('taller');
    expect(grupoDe('configuracion')).toBe('administracion');
    expect(grupoDe('roles')).toBe('administracion');
  });

  it('«Roles» sólo se ofrece a quien reparte roles; el resto de secciones, a todos', () => {
    expect(seccionesDe('administracion', false).map((s) => s.id)).toEqual(['configuracion']);
    expect(seccionesDe('administracion', true).map((s) => s.id)).toEqual(['configuracion', 'roles']);
    for (const gestiona of [true, false]) {
      expect(seccionesDe('clientes', gestiona).map((s) => s.id)).toEqual(['resumen', 'equipos', 'calendario', 'avisos']);
      expect(seccionesDe('taller', gestiona).map((s) => s.id)).toEqual(['servicios']);
    }
  });

  it('al pulsar un grupo se va a su primera sección', () => {
    expect(primeraSeccion('clientes')).toBe('resumen');
    expect(primeraSeccion('taller')).toBe('servicios');
    expect(primeraSeccion('administracion')).toBe('configuracion');
  });
});

describe('seccionDeHash', () => {
  it.each(['resumen', 'equipos', 'calendario', 'avisos', 'servicios', 'configuracion'] as const)('el hash de siempre #%s sigue llevando a su sección', (id) => {
    expect(seccionDeHash(`#${id}`)).toBe(id);
    expect(seccionDeHash(id)).toBe(id);
  });

  it('#roles es la sección nueva', () => {
    expect(seccionDeHash('#roles')).toBe('roles');
  });

  it.each(['', '#', '#otra', '#Resumen', '#resumen/1', '#constructor', '#toString'])('un hash vacío o que no se conoce (%j) lleva al resumen', (h) => {
    expect(seccionDeHash(h)).toBe('resumen');
  });
});

describe('lo que la app enseña según /roles/me', () => {
  it('mientras no se sabe quién es, no se le ofrece ningún cambio', () => {
    expect(SIN_ROL).toMatchObject({ role: 'LECTOR', admin: false, permissions: [], canManageRoles: false });
    for (const p of PERMISOS) expect(tiene(SIN_ROL, p)).toBe(false);
    expect(tiene(null, 'importar')).toBe(false);
  });

  it('tiene() mira la lista que mandó el servidor, no vuelve a calcular la matriz', () => {
    const raro: MiRol = { ...yo('LECTOR'), permissions: ['importar'] };
    expect(tiene(raro, 'importar')).toBe(true);
    expect(tiene(raro, 'config.write')).toBe(false);
    expect(tiene(yo('DIRECTOR_TECNICO'), 'config.write')).toBe(true);
    expect(tiene(yo('COMERCIAL'), 'config.write')).toBe(false);
    for (const p of PERMISOS) expect(tiene(yo('LECTOR', true), p)).toBe(true);
  });

  it('la cabecera dice el rol; un administrador del portal lo dice primero', () => {
    expect(ROLES_APP.map((r) => etiquetaMiRol(yo(r)))).toEqual(['Lector', 'Comercial', 'Técnico', 'Director Técnico']);
    expect(etiquetaMiRol(yo('LECTOR', true))).toBe('Administrador del portal');
    expect(etiquetaMiRol(yo('DIRECTOR_TECNICO', true))).toBe('Administrador del portal · Director Técnico');
  });

  it('el aviso de lo que no se puede dice el rol y a quién pedírselo', () => {
    expect(motivoSinPermiso(yo('LECTOR'))).toBe('Tu rol (Lector) sólo permite consultar. Pide a un administrador del portal el rol que necesitas.');
    expect(motivoSinPermiso(yo('COMERCIAL'))).toBe('Tu rol (Comercial) no permite este cambio. Pide a un administrador del portal el rol que necesitas.');
    expect(motivoSinPermiso(null)).toBe('Tu rol (Lector) sólo permite consultar. Pide a un administrador del portal el rol que necesitas.');
  });
});
