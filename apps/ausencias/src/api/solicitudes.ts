import { get, post, postSolapable } from './http';
import type { Contexto, NuevaSolicitud, Solicitud, SolicitudPendiente } from './tipos';

// ARQ-612 — los endpoints de la solicitud, sacados de api.ts tal cual en tres
// bloques: el contexto de la pantalla, las listas de quien pide y de quien
// firma, el alta, la decisión de la bandeja y la retirada por su dueño. api.ts
// lo reexporta (lo vigila barril.test.ts).

export const fetchContexto = () => get<Contexto>('/api/ausencias/contexto');

export const fetchMisSolicitudes = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/mis-solicitudes').then((d) => d.solicitudes);

export const fetchPendientes = () =>
  get<{ solicitudes: SolicitudPendiente[] }>('/api/ausencias/pendientes').then((d) => d.solicitudes);

export const crearSolicitud = (s: NuevaSolicitud) => postSolapable<Solicitud>('/api/ausencias/solicitudes', s);

export const decidirSolicitud = (id: string, aprueba: boolean, motivo?: string) =>
  post<Solicitud>(`/api/ausencias/solicitudes/${encodeURIComponent(id)}/decision`, { aprueba, motivo });

/**
 * El dueño retira su propia SOLICITUD, antes de que nadie la firme.
 *
 * No la borra: la deja en `rechazada` con su `anuladaAt`, igual que una anulación
 * aprobada, y sigue en el registro. Por eso es un POST y no un DELETE — y además
 * el DELETE de esa ruta ya existe, es de admin y hace otra cosa.
 *
 * Avisa al jefe, que la tenía en la bandeja y va a verla desaparecer.
 */
export const retirarSolicitud = (id: string) =>
  post<Solicitud>(`/api/ausencias/solicitudes/${encodeURIComponent(id)}/retirar`, {});
