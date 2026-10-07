/**
 * Navegación en dos niveles (grupo → sección) y lo que la app enseña según el
 * rol de quien la usa. Puro: sin React ni red.
 *
 * Las secciones siguen yendo por hash (#resumen, #equipos, #calendario,
 * #avisos, #servicios, #configuracion y el nuevo #roles): el grupo no está en
 * la URL, se deduce de la sección, así que los enlaces de siempre siguen valiendo.
 *
 * Lo de los permisos aquí sólo decide qué se oculta o se desactiva. La guarda
 * de verdad es la del servidor, que responde 403.
 */
import { ETIQUETA_ROL_APP, type MiRol, type Permiso } from '../dominio';

export const GRUPOS = [
  { id: 'clientes', label: 'Clientes y calibraciones' },
  { id: 'taller', label: 'Taller' },
  { id: 'administracion', label: 'Administración' },
] as const;
export type Grupo = (typeof GRUPOS)[number]['id'];

/** `soloGestores`: sólo se ofrece a quien reparte roles (los administradores del portal). */
export const SECCIONES = [
  { id: 'resumen', label: 'Resumen', grupo: 'clientes', soloGestores: false },
  { id: 'equipos', label: 'Equipos', grupo: 'clientes', soloGestores: false },
  { id: 'calendario', label: 'Calendario Calibraciones', grupo: 'clientes', soloGestores: false },
  { id: 'avisos', label: 'Avisos a clientes', grupo: 'clientes', soloGestores: false },
  // Aquí irá también la «Agenda del taller».
  { id: 'servicios', label: 'Servicios', grupo: 'taller', soloGestores: false },
  { id: 'configuracion', label: 'Configuración', grupo: 'administracion', soloGestores: false },
  { id: 'roles', label: 'Roles', grupo: 'administracion', soloGestores: true },
] as const satisfies readonly { id: string; label: string; grupo: Grupo; soloGestores: boolean }[];
export type Seccion = (typeof SECCIONES)[number]['id'];

export const SECCION_INICIAL: Seccion = 'resumen';

/** La sección de un hash (`#servicios` o `servicios`); la inicial si está vacío o no se conoce. */
export function seccionDeHash(hash: string): Seccion {
  const h = hash.replace(/^#/, '');
  return SECCIONES.find((s) => s.id === h)?.id ?? SECCION_INICIAL;
}

export function grupoDe(seccion: Seccion): Grupo {
  return SECCIONES.find((s) => s.id === seccion)!.grupo;
}

/** Las secciones de un grupo que se le ofrecen a esta persona. */
export function seccionesDe(grupo: Grupo, gestionaRoles: boolean) {
  return SECCIONES.filter((s) => s.grupo === grupo && (gestionaRoles || !s.soloGestores));
}

/** A dónde lleva pulsar un grupo. */
export function primeraSeccion(grupo: Grupo): Seccion {
  return SECCIONES.find((s) => s.grupo === grupo)!.id;
}

/** Lo que vale mientras no ha llegado /roles/me (o si falla): como un Lector, sin ningún cambio a la vista. */
export const SIN_ROL: MiRol = { userId: '', email: '', role: 'LECTOR', admin: false, permissions: [], canManageRoles: false };

/** ¿Le dio el servidor este permiso? Sólo mira la lista de /roles/me. */
export function tiene(yo: MiRol | null, permiso: Permiso): boolean {
  return (yo ?? SIN_ROL).permissions.includes(permiso);
}

/** El rol tal como se enseña en la cabecera. */
export function etiquetaMiRol(yo: MiRol): string {
  if (!yo.admin) return ETIQUETA_ROL_APP[yo.role];
  return yo.role === 'LECTOR' ? 'Administrador del portal' : `Administrador del portal · ${ETIQUETA_ROL_APP[yo.role]}`;
}

/** Por qué algo está desactivado, para el `title` o la nota de la sección. */
export function motivoSinPermiso(yo: MiRol | null): string {
  const y = yo ?? SIN_ROL;
  const que = y.permissions.length === 0 ? 'sólo permite consultar' : 'no permite este cambio';
  return `Tu rol (${ETIQUETA_ROL_APP[y.role]}) ${que}. Pide a un administrador del portal el rol que necesitas.`;
}
