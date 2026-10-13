import { describe, it, expect } from 'vitest';
import { ROLES_APP, permisosDe, type Exportacion, type MiRol, type RolApp } from '../dominio';
import { NOTA_EXPORTAR, nombreDeDescarga, nombrePorDefecto, textoUltimaExportacion } from './exportar';
import { SIN_ROL, tiene } from './navegacion';

// Exportar la F-ST-022 (lote 9e): lo poco que calcula la pantalla. El fichero lo
// genera el servidor; aquí, con qué nombre se guarda y qué se dice de la última
// exportación. Sin reloj ni zona de la máquina. Correos inventados.

const ULTIMA: Exportacion = { id: 3, por: 'comercial@example.com', en: '2026-10-13 01:10:00+00', hoy: '2026-10-12', filas: 366, retirados: 2, congelacionId: 7, archivo: 'F-ST-022 Trazabilidad Mttos Clientes 2026-10-12.xlsx', sha256: 'ab'.repeat(32) };

describe('el nombre con que se guarda', () => {
  it('es el que manda el servidor en Content-Disposition, con sus espacios', () => {
    expect(nombreDeDescarga('attachment; filename="F-ST-022 Trazabilidad Mttos Clientes 2026-10-12.xlsx"', '2026-10-12')).toBe('F-ST-022 Trazabilidad Mttos Clientes 2026-10-12.xlsx');
    expect(nombreDeDescarga("attachment; filename*=UTF-8''F-ST-022%20Trazabilidad%202026-10-12.xlsx", '2026-10-12')).toBe('F-ST-022 Trazabilidad 2026-10-12.xlsx');
  });

  it('si la cabecera no llega (o no trae nombre), uno por defecto con el día de la tabla: nunca un fichero sin nombre', () => {
    expect(nombrePorDefecto('2026-10-12')).toBe('F-ST-022 Trazabilidad Mttos Clientes 2026-10-12.xlsx');
    for (const cd of [null, '', 'attachment', 'attachment; filename=""']) expect(nombreDeDescarga(cd, '2026-10-12')).toBe(nombrePorDefecto('2026-10-12'));
  });

  it('un nombre con una ruta dentro se queda en su último tramo: se guarda donde diga el navegador', () => {
    expect(nombreDeDescarga('attachment; filename="..\\..\\otra/cosa.xlsx"', '2026-10-12')).toBe('cosa.xlsx');
  });
});

describe('«última exportación»', () => {
  it('quién y cuándo (en hora de Colombia), con cuántas filas llevaba', () => {
    expect(textoUltimaExportacion({ ultima: ULTIMA, total: 3 })).toBe('Última exportación: comercial@example.com el 12/10/2026 20:10 · 366 filas y 2 retirados · van 3');
    expect(textoUltimaExportacion({ ultima: { ...ULTIMA, filas: 1, retirados: 0 }, total: 1 })).toBe('Última exportación: comercial@example.com el 12/10/2026 20:10 · 1 fila · va 1');
  });

  it('si nadie ha exportado todavía lo dice; y mientras no se sabe, no dice nada', () => {
    expect(textoUltimaExportacion({ ultima: null, total: 0 })).toBe('Última exportación: todavía no se ha exportado ninguna.');
    expect(textoUltimaExportacion(null)).toBe('');
  });
});

describe('quién ve el botón', () => {
  const yo = (role: RolApp, admin = false): MiRol => ({ userId: 'u1', email: 'u1@example.com', role, admin, permissions: permisosDe(role, admin), canManageRoles: admin });

  it('Comercial, Técnico y Director Técnico (y un administrador del portal, tenga el rol que tenga); el Lector no, ni quien aún no sabe su rol', () => {
    expect(ROLES_APP.filter((r) => tiene(yo(r), 'hoja.exportar'))).toEqual(['COMERCIAL', 'TECNICO', 'DIRECTOR_TECNICO']);
    expect(tiene(yo('LECTOR', true), 'hoja.exportar')).toBe(true);
    expect(tiene(SIN_ROL, 'hoja.exportar')).toBe(false);
  });
});

describe('lo que dice el botón', () => {
  it('avisa de que exporta la hoja entera, no lo filtrado, y de que queda apuntado', () => {
    expect(NOTA_EXPORTAR).toMatch(/hoja entera/);
    expect(NOTA_EXPORTAR).toMatch(/no .*filtros/);
    expect(NOTA_EXPORTAR).toMatch(/queda apuntad/);
  });
});
