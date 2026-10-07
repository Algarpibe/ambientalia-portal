/**
 * Quién soy en la app (lo que devolvió GET /trazabilidad/roles/me), al alcance
 * de cualquier vista. Sirve para ocultar o desactivar lo que el rol no permite;
 * no protege nada: quien se salte la interfaz se encuentra el 403 del servidor.
 */
import { createContext, useContext } from 'react';
import type { MiRol, Permiso } from './dominio';
import { SIN_ROL, motivoSinPermiso, tiene } from './lib/navegacion';

/** Mientras /roles/me no ha llegado (o si falla) vale SIN_ROL: como un Lector. */
export const PermisosContext = createContext<MiRol>(SIN_ROL);

export function usePermisos(): { yo: MiRol; puede: (permiso: Permiso) => boolean; motivo: string } {
  const yo = useContext(PermisosContext);
  return { yo, puede: (permiso) => tiene(yo, permiso), motivo: motivoSinPermiso(yo) };
}
