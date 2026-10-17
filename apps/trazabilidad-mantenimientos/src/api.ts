/** Cliente HTTP de la API de Trazabilidad (hub-api, `/api/trazabilidad/*`). */
import { authHeaders } from '@suite/auth-client';
import type { CategoriaAgenda, ConfiguracionAgenda, CongelacionFst022, ContactoCliente, EquipoVista, EstadoDesk, EtapaAgenda, FlujoAgenda, ItemReparto, MiRol, PlazoServicio, RespuestaAgenda, RespuestaCruceFst022, RespuestaPlanMaestro, ResumenImportacion, RolApp, RolEstado, Seguimiento, ServicioVista, SincronizacionMaestro, TipoServicioOpcion, UsuarioRol } from './dominio';
import type { ApunteRetiro, PasadaCalibraciones, RespuestaEdicion, RespuestaExportaciones,RespuestaHistorialCalibraciones, RespuestaHoja, RespuestaMarcas, RespuestaPlanCalibraciones, RespuestaRetiro } from './dominio';
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
  /** La tabla de la pestaña «Trazabilidad F-ST-022»: la hoja congelada con sus valores de hoy, su resumen y lo que está en el inventario y no en la hoja. Sólo lectura. */
  hoja: () => request<RespuestaHoja>('GET', '/hoja'),
  /**
   * Exportar la F-ST-022 (pide `hoja.exportar`): el .xlsx de la hoja entera, a hoy, y el Content-Disposition con su nombre. La petición
   * lleva el token, así que no vale un enlace: se pide, y lo recibido se guarda desde la página. El servidor la deja apuntada.
   */
  exportarHoja: async (): Promise<{ blob: Blob; contentDisposition: string | null }> => {
    const res = await fetch(`${API_BASE}/exportar`, { headers: authHeaders() });
    if (!res.ok) throw errorFromResponse(res.status, await res.json().catch(() => null));
    return { blob: await res.blob(), contentDisposition: res.headers.get('Content-Disposition') };
  },
  /** La última exportación (quién, cuándo, cuántas filas) y cuántas van. Sólo la firma y recuentos. */
  exportaciones: () => request<RespuestaExportaciones>('GET', '/exportaciones'),
  /** El plan del cruce del inventario con el maestro de equipos de Desk 2.0, en recuentos (y su detalle, sólo si puedo sincronizar). No escribe. */
  planMaestro: () => request<RespuestaPlanMaestro>('GET', '/maestro/plan'),
  /** Cruce informativo, por marca, de la F-ST-022 congelada con el maestro. Sólo recuentos; no escribe. */
  cruceMaestro: () => request<RespuestaCruceFst022>('GET', '/maestro/cruce'),
  /** Aplica el plan que se revisó (su `huella`): 409 si ya es otro o si Desk 2.0 no contesta. Devuelve su fila de auditoría. */
  sincronizarMaestro: (huella: string) => request<SincronizacionMaestro>('POST', '/maestro/sincronizar', { huella }),
  /** El plan de las calibraciones que hay en los tickets de Desk 2.0, en recuentos, con la salud de la lectura (y su detalle, sólo si puedo traerlas). No escribe. */
  planCalibraciones: () => request<RespuestaPlanCalibraciones>('GET', '/calibraciones/plan'),
  /** Aplica el plan que se revisó (su `huella`): 409 si ya es otro, si Desk 2.0 no contesta o si ningún ticket trae ya el campo. Devuelve la fila de su pasada. */
  traerCalibraciones: (huella: string) => request<PasadaCalibraciones>('POST', '/calibraciones/sincronizar', { huella }),
  /** El historial de calibraciones de un equipo (la más reciente primero) y cuál es la que cuenta. */
  calibracionesDeEquipo: (clave: string) => request<RespuestaHistorialCalibraciones>('GET', `/equipos/${encodeURIComponent(clave)}/calibraciones`),
  // Corregir una fecha a mano (pide `calibraciones.write`): las tres devuelven el historial ya recalculado. Una fecha nunca se edita.
  /** Registra una calibración manual de un equipo (`clave`) o de una fila de la hoja (`fila`); `corrigeTicket` = el ticket cuya fecha corrige. */
  registrarCalibracion: (c: ({ clave: string } | { fila: number }) & { fecha: string; motivo: string; corrigeTicket: number | null }) => request<RespuestaEdicion>('POST', '/calibraciones/manual', c),
  /** Anula una calibración guardada; con un id negativo, la partida que esa fila de la hoja (`-id`) toma de la congelación. */
  anularCalibracion: (id: number, motivo: string) => request<RespuestaEdicion>('POST', id < 0 ? `/calibraciones/partida/${-id}/anular` : `/calibraciones/${id}/anular`, { motivo }),
  // Retirar y reincorporar a mano (pide `inventario.write`): un equipo (`clave`) o una fila de la hoja sin equipo (`fila`). Nada se borra.
  retirar: (destino: { clave: string } | { fila: number }, retirar: boolean, motivo: string) =>
    request<RespuestaRetiro>('POST', `${'clave' in destino ? `/equipos/${encodeURIComponent(destino.clave)}` : `/filas/${destino.fila}`}/${retirar ? 'retirar' : 'reincorporar'}`, { motivo }),
  /** La auditoría de retiros de un equipo o de una fila de la hoja, la más reciente primero. */
  retiros: (destino: { clave: string } | { fila: number }) => request<{ retiros: ApunteRetiro[] }>('GET', `/retiros?${'clave' in destino ? `clave=${encodeURIComponent(destino.clave)}` : `fila=${destino.fila}`}`),
  /** Las marcas en seguimiento (lote 9f), cada una con su vista previa en recuentos, y los últimos cambios. */
  marcas: () => request<RespuestaMarcas>('GET', '/marcas'),
  /** Enciende (`incluir`) o apaga una marca, con motivo (pide `inventario.write`). Devuelve las marcas ya actualizadas. No envía nada. */
  cambiarMarca: (clave: string, incluir: boolean, motivo: string) => request<RespuestaMarcas>('POST', `/marcas/${encodeURIComponent(clave)}`, { incluir, motivo }),
  guardarSeguimiento: (clave: string, s: Seguimiento) =>
    request<{ ok: true }>('PUT', `/seguimiento/${encodeURIComponent(clave)}`, s),
  registrarAvisos: (claves: string[], fecha: string) => request<{ actualizados: number }>('POST', '/avisos', { claves, fecha }),
};
