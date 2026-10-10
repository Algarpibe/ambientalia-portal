/**
 * Roles y permisos de Trazabilidad Mantenimientos Clientes. La matriz vive
 * AQUÍ y sólo aquí: el router la usa para dejar pasar o no cada escritura y la
 * app, para ocultar o desactivar lo que el rol no permite (la guarda de verdad
 * es la del servidor).
 *
 * Puro y sin imports, como dominio.ts: lo carga tal cual la app del portal.
 *
 * El rol de cada persona está en portal.tmc_user_roles (migración 049). Quien
 * tiene la app y no tiene fila es LECTOR: lo ve todo y no cambia nada. Los
 * administradores del portal (role = admin en su usuario) tienen todos los
 * permisos, tengan el rol que tengan, y son los únicos que reparten roles.
 *
 * Ojo con el nombre: el «rol» de un ESTADO de Desk en el reloj del plazo
 * (cuenta / standby / terminado) es otra cosa y vive en dominio.ts
 * (ROLES_ESTADO). Aquí todo lo de las personas lleva «App» o «Permiso».
 */

/** Del que menos puede al que más. */
export const ROLES_APP = ['LECTOR', 'COMERCIAL', 'TECNICO', 'DIRECTOR_TECNICO'] as const;
export type RolApp = (typeof ROLES_APP)[number];

/** El rol de quien tiene la app y ninguna fila en portal.tmc_user_roles. */
export const ROL_APP_POR_DEFECTO: RolApp = 'LECTOR';

export const ETIQUETA_ROL_APP: Record<RolApp, string> = {
  LECTOR: 'Lector',
  COMERCIAL: 'Comercial',
  TECNICO: 'Técnico',
  DIRECTOR_TECNICO: 'Director Técnico',
};

/**
 * Los permisos, con nombres estables: los usan el router, la app y las pruebas.
 * Los de la agenda del taller y `calibraciones.write` ya están aunque ningún
 * endpoint los pida todavía, para que esas fases no tengan que tocar la matriz.
 */
export const PERMISOS = [
  /** Seguimiento de un equipo: nota, servicio programado, «en Ambientalia» y aviso enviado. */
  'seguimiento.write',
  /** Avisos manuales: marcar como avisado en bloque. */
  'avisos.write',
  /** Contacto de un cliente para los avisos. */
  'contactos.write',
  /** Tipo de servicio puesto a mano a un ticket. */
  'servicios.tipo.write',
  /** Importaba y congelaba la F-ST-022. Esa subida se retiró el 10/10/2026: hoy no abre ninguna ruta; se queda porque los nombres de permiso son estables. */
  'importar',
  /** Toda la Configuración: plazos y papel de cada estado de Desk (y, con la agenda, puestos y duraciones). */
  'config.write',
  /** Agenda del taller: asignar un puesto. */
  'agenda.asignar',
  /** Agenda del taller: liberar un puesto a mano. */
  'agenda.liberar',
  /** Agenda del taller: confirmar el reparto inicial. */
  'agenda.reparto',
  /** Agenda del taller: marcar a mano el flujo de un ticket. */
  'agenda.flujo',
  /** Reservado: confirmar o registrar calibraciones. */
  'calibraciones.write',
  /** Maestro de equipos: aplicar al inventario el plan del cruce con Desk 2.0 (y ver su detalle). */
  'maestro.sincronizar',
  /** Repartir roles. De ningún rol: sólo de los administradores del portal. */
  'roles.manage',
] as const;
export type Permiso = (typeof PERMISOS)[number];

const DE_COMERCIAL: readonly Permiso[] = ['seguimiento.write', 'avisos.write', 'contactos.write'];
const DE_TECNICO: readonly Permiso[] = ['seguimiento.write', 'servicios.tipo.write', 'calibraciones.write'];

const MATRIZ: Record<RolApp, readonly Permiso[]> = {
  LECTOR: [],
  COMERCIAL: DE_COMERCIAL,
  TECNICO: DE_TECNICO,
  // Todo lo de los dos anteriores, más la Configuración, la agenda y el maestro de equipos (e `importar`,
  // que ya no abre nada) (es el «Director Técnico» de D14 en docs/trazabilidad-agenda-taller.md).
  DIRECTOR_TECNICO: [...DE_COMERCIAL, ...DE_TECNICO, 'importar', 'config.write', 'agenda.asignar', 'agenda.liberar', 'agenda.reparto', 'agenda.flujo', 'maestro.sincronizar'],
};

export function esRolApp(v: unknown): v is RolApp {
  return typeof v === 'string' && (ROLES_APP as readonly string[]).includes(v);
}

/** Valor guardado → rol. Sin fila, o con un valor que no se conoce, el que menos puede. */
export function resolverRol(guardado: string | null | undefined): RolApp {
  return esRolApp(guardado) ? guardado : ROL_APP_POR_DEFECTO;
}

/** ¿Puede este rol hacer esto? Un administrador del portal puede siempre. */
export function puede(rol: RolApp, permiso: Permiso, esAdmin = false): boolean {
  return esAdmin || MATRIZ[rol].includes(permiso);
}

/** Los permisos de un rol, en el orden de PERMISOS (todos, si es administrador del portal). */
export function permisosDe(rol: RolApp, esAdmin = false): Permiso[] {
  return PERMISOS.filter((p) => puede(rol, p, esAdmin));
}
