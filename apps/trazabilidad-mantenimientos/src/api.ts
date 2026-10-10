/** Cliente HTTP de la API de Trazabilidad (hub-api, `/api/trazabilidad/*`). */
import { authHeaders } from '@suite/auth-client';
import type { CategoriaAgenda, ConfiguracionAgenda, CongelacionFst022, ContactoCliente, EquipoVista, EstadoDesk, EtapaAgenda, FlujoAgenda, ItemReparto, MiRol, PlazoServicio, RespuestaAgenda, RespuestaCruceFst022, RespuestaPlanMaestro, ResumenImportacion, RolApp, RolEstado, Seguimiento, ServicioVista, SincronizacionMaestro, TipoServicioOpcion, UsuarioRol } from './dominio';
import { errorFromResponse } from './lib/apiError';

const API_BASE = `${(import.meta.env.VITE_HUB_API_URL as string | undefined) ?? ''}/api/trazabilidad`;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw errorFromResponse(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

export interface Inventario {
  hoy: string;
  equipos: EquipoVista[];
  /** La última importación que quedó registrada antes de retirar la subida. La app ya no la enseña (la cabecera dice la congelación). */
  ultimaImportacion: ResumenImportacion | null;
  /** Los contactos puestos a mano a clientes: ganan al contacto de Desk de sus equipos. */
  contactos: ContactoCliente[];
}

/** Tickets de Desk sin cerrar, con su plazo calculado en el servidor (pausas de standby y trabajo terminado incluidos). */
export interface Servicios {
  hoy: string;
  servicios: ServicioVista[];
  /** Festivos del tramo que puede pintar el calendario de barras. */
  festivos: string[];
  /** Los tipos de servicio que se pueden elegir a mano para un ticket, en el orden de Configuracion. */
  tipos: TipoServicioOpcion[];
}

export const api = {
  /** Mi rol en la app y lo que me deja hacer (`permissions`). */
  yo: () => request<MiRol>('GET', '/roles/me'),
  /** La gente con la app y su rol. Sólo para administradores del portal. */
  roles: () => request<{ usuarios: UsuarioRol[] }>('GET', '/roles'),
  /** Pone el rol de una persona. Sólo para administradores del portal. */
  guardarRol: (userId: string, role: RolApp) => request<{ userId: string; role: RolApp }>('PUT', `/roles/${encodeURIComponent(userId)}`, { role }),
  inventario: () => request<Inventario>('GET', '/equipos'),
  /**
   * Pone a mano el contacto de un cliente (`emails` vacío = quitarlo y volver al de Desk). Devuelve el inventario ya
   * actualizado. Sólo guarda a quién se le escribiría: la app no envía correos (el aviso automático es una simulación).
   */
  guardarContacto: (cliente: string, emails: string[], nombre: string) => request<Inventario>('PUT', '/contactos', { cliente, emails, nombre }),
  servicios: () => request<Servicios>('GET', '/servicios'),
  /** Pone a mano el tipo de servicio de un ticket (null = quitarlo). Devuelve los servicios ya recalculados. */
  fijarTipoServicio: (numero: number, tipo: string | null) => request<Servicios>('PUT', `/servicios/${numero}/tipo`, { tipo }),
  plazos: () => request<{ plazos: PlazoServicio[] }>('GET', '/plazos'),
  guardarPlazo: (tipo: string, dias: number | null) => request<{ plazos: PlazoServicio[] }>('PUT', '/plazos', { tipo, dias }),
  /** Los estados de Desk con su rol en el reloj del plazo (bloque «Estados de Desk» de Configuracion). */
  estados: () => request<{ estados: EstadoDesk[] }>('GET', '/estados'),
  /** Elige el rol de un estado de Desk: cuenta, standby (reloj en pausa) o terminado (reloj parado). Devuelve la lista entera ya actualizada. */
  guardarEstado: (estado: string, rol: RolEstado) => request<{ estados: EstadoDesk[] }>('PUT', '/estados', { estado, rol }),
  /** La configuración de la agenda del taller: puestos, duraciones, la categoría de cada estado y los tipos que traen sus tickets abiertos. */
  configuracionAgenda: () => request<ConfiguracionAgenda>('GET', '/agenda/configuracion'),
  // Los tres cambios devuelven la configuración entera ya actualizada, y quedan firmados.
  guardarPuestos: (etapa: EtapaAgenda, puestos: number) => request<ConfiguracionAgenda>('PUT', '/agenda/configuracion/puestos', { etapa, puestos }),
  /** `dias` null quita la fila del tipo (vuelve a valer la «*» de la etapa); la «*» no se puede quitar. */
  guardarDuracion: (etapa: EtapaAgenda, tipo: string, dias: number | null) => request<ConfiguracionAgenda>('PUT', '/agenda/configuracion/duraciones', { etapa, tipo, dias }),
  /** Sólo la categoría (y la etapa, si es una etapa activa): no toca el rol del reloj ni su firma. */
  guardarCategoria: (estado: string, categoria: CategoriaAgenda, etapa: EtapaAgenda | null) =>
    request<ConfiguracionAgenda>('PUT', '/agenda/configuracion/estados', { estado, categoria, etapa }),
  /** La agenda del taller a hoy: puestos, filas, listas aparte, avisos, la ficha de cada ticket y el eje del calendario. Lanza antes la pasada de la agenda. */
  agenda: () => request<RespuestaAgenda>('GET', '/agenda'),
  // Las cuatro acciones de la agenda devuelven la agenda ya leída otra vez: no hace falta volver a pedirla.
  /** La propuesta de reparto inicial (pide `agenda.reparto`); no escribe. */
  propuestaReparto: () => request<{ hoy: string; reparto: ItemReparto[] }>('GET', '/agenda/reparto'),
  confirmarReparto: (reparto: { numero: number; etapa: EtapaAgenda; puesto: number }[]) => request<RespuestaAgenda>('POST', '/agenda/reparto', { reparto }),
  /** `motivo` es obligatorio si el ticket no es el primero de la fila que ya está en la etapa. */
  asignarPuesto: (numero: number, etapa: EtapaAgenda, puesto: number, motivo?: string) => request<RespuestaAgenda>('POST', '/agenda/asignaciones', { numero, etapa, puesto, motivo }),
  liberarPuesto: (numero: number, motivo: string) => request<RespuestaAgenda>('POST', '/agenda/liberar', { numero, motivo }),
  /** `null` quita la marca. Sólo vale para el ticket cuya fuente no trae clasificación. */
  marcarFlujo: (numero: number, flujo: FlujoAgenda | null) => request<RespuestaAgenda>('PUT', `/agenda/flujo/${numero}`, { flujo }),
  /** Las congelaciones de la F-ST-022, la más reciente primero: sólo metadatos y recuentos. Sólo se leen: la Excel ya no se sube (ni importar ni congelar). */
  congelaciones: () => request<{ congelaciones: CongelacionFst022[] }>('GET', '/fst022/congelaciones'),
  /** El plan del cruce del inventario con el maestro de equipos de Desk 2.0, en recuentos (y su detalle, sólo si puedo sincronizar). No escribe. */
  planMaestro: () => request<RespuestaPlanMaestro>('GET', '/maestro/plan'),
  /** Cruce informativo, por marca, de la F-ST-022 congelada con el maestro. Sólo recuentos; no escribe. */
  cruceMaestro: () => request<RespuestaCruceFst022>('GET', '/maestro/cruce'),
  /** Aplica el plan que se revisó (su `huella`): 409 si ya es otro o si Desk 2.0 no contesta. Devuelve su fila de auditoría. */
  sincronizarMaestro: (huella: string) => request<SincronizacionMaestro>('POST', '/maestro/sincronizar', { huella }),
  guardarSeguimiento: (clave: string, s: Seguimiento) =>
    request<{ ok: true }>('PUT', `/seguimiento/${encodeURIComponent(clave)}`, s),
  registrarAvisos: (claves: string[], fecha: string) => request<{ actualizados: number }>('POST', '/avisos', { claves, fecha }),
};
