import type {
  Adjunto,
  ClaseModificacion,
  EstadoModificacion,
  Modificacion,
  PayloadEvento,
  Solicitud,
  TipoSolicitud,
} from '../types.js';
import type { PoolClient } from './comun.js';

// ARQ-612 — piezas que comparten varios trozos de repo/: traducciones de filas,
// las consultas base de solicitudes y modificaciones, y `anotarEventoDeCalendario`.
// Es INTERNO: repo.ts no lo reexporta (lo vigila barril.test.ts), porque sus
// funciones no son parte de la API del repositorio y el doble de router.test.ts
// no las conoce. Lo que sí es público, como el tipo `EmpleadoConSaldo`, lo
// reexporta el trozo dueño (saldos.ts).

/** Un empleado con sus dos configuraciones de saldo, tal como salen de la BD. */
export interface EmpleadoConSaldo {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  /** Null mientras nadie lo haya configurado. Va siempre en pareja con la fecha. */
  saldoCorte: number | null;
  fechaCorte: string | null;
  /** La bolsa de compensatorios, independiente de la de vacaciones. */
  compensatoriosSaldoCorte: number | null;
  compensatoriosFechaCorte: string | null;
  /** Para congelar el devengo de quien ya se fue. Ver `hoyCongelado`. */
  fechaRetiro: string | null;
  /**
   * Quién registró la baja. Viaja con el saldo y no con la ficha porque la vista
   * de retirados enseña las dos cosas juntas, y el número de ahí es el que se
   * paga: sin la constancia al lado, nadie sabe a quién preguntarle por él.
   */
  retiradoPor: string | null;
}

export interface FilaEmpleadoSaldoDb {
  id: string;
  nombre_completo: string;
  correo: string;
  saldo_corte: number | null;
  fecha_corte: string | null;
  compensatorios_saldo_corte: number | null;
  compensatorios_fecha_corte: string | null;
  fecha_retiro: string | null;
  retirado_por: string | null;
}

export function aEmpleadoConSaldo(r: FilaEmpleadoSaldoDb): EmpleadoConSaldo {
  return {
    empleadoId: r.id,
    nombreCompleto: r.nombre_completo,
    correo: r.correo,
    saldoCorte: r.saldo_corte,
    fechaCorte: r.fecha_corte,
    compensatoriosSaldoCorte: r.compensatorios_saldo_corte,
    compensatoriosFechaCorte: r.compensatorios_fecha_corte,
    fechaRetiro: r.fecha_retiro,
    retiradoPor: r.retirado_por,
  };
}

/**
 * Las columnas del satélite, siempre con el prefijo `mod_`.
 *
 * El prefijo no es cosmético: estas mismas columnas viajan dentro del `LEFT
 * JOIN` de `SELECT_SOLICITUD`, donde `id`, `estado`, `motivo_rechazo`,
 * `created_at`, `aprobador_correo`, `decidida_at` y `solicitante_email` chocan
 * una a una con las de la solicitud. Con un solo juego de alias, un único mapa
 * (`aModificacion`) sirve para la consulta suelta y para la del JOIN.
 *
 * Se consulta siempre con la tabla aliasada `m` por lo mismo.
 */
export const COLS_MODIFICACION = `
  m.id AS mod_id, m.solicitud_id AS mod_solicitud_id, m.clase AS mod_clase,
  m.estado_previo AS mod_estado_previo,
  m.fecha_inicio_previa::text AS mod_fecha_inicio_previa,
  m.fecha_fin_previa::text    AS mod_fecha_fin_previa,
  -- ::float8 por lo mismo que en dias_habiles de la solicitud: NUMERIC llega
  -- como STRING y "5.0" rompe la aritmetica de los correos y de la UI.
  m.dias_habiles_previos::float8 AS mod_dias_habiles_previos,
  m.fecha_inicio_nueva::text  AS mod_fecha_inicio_nueva,
  m.fecha_fin_nueva::text     AS mod_fecha_fin_nueva,
  m.dias_habiles_nuevos::float8 AS mod_dias_habiles_nuevos,
  m.motivo AS mod_motivo, m.estado AS mod_estado,
  m.aprobador_correo AS mod_aprobador_correo,
  m.solicitante_email AS mod_solicitante_email,
  m.decidida_at::text AS mod_decidida_at,
  m.motivo_rechazo AS mod_motivo_rechazo,
  m.created_at::text AS mod_created_at`;

export const SELECT_MODIFICACION = `SELECT ${COLS_MODIFICACION} FROM portal.solicitud_modificaciones m`;

export interface FilaModificacionDb {
  mod_id: string;
  mod_solicitud_id: string;
  mod_clase: ClaseModificacion;
  mod_estado_previo: Solicitud['estado'];
  mod_fecha_inicio_previa: string;
  mod_fecha_fin_previa: string;
  mod_dias_habiles_previos: number;
  mod_fecha_inicio_nueva: string | null;
  mod_fecha_fin_nueva: string | null;
  mod_dias_habiles_nuevos: number | null;
  mod_motivo: string | null;
  mod_estado: EstadoModificacion;
  mod_aprobador_correo: string;
  mod_solicitante_email: string;
  mod_decidida_at: string | null;
  mod_motivo_rechazo: string | null;
  mod_created_at: string;
}

/** Las mismas columnas vistas desde el LEFT JOIN: todas null si no hay propuesta. */
type FilaModificacionJoinDb = { [K in keyof FilaModificacionDb]: FilaModificacionDb[K] | null };

export function aModificacion(r: FilaModificacionDb): Modificacion {
  return {
    id: r.mod_id,
    solicitudId: r.mod_solicitud_id,
    clase: r.mod_clase,
    estadoPrevio: r.mod_estado_previo,
    fechaInicioPrevia: r.mod_fecha_inicio_previa,
    fechaFinPrevia: r.mod_fecha_fin_previa,
    diasHabilesPrevios: r.mod_dias_habiles_previos,
    fechaInicioNueva: r.mod_fecha_inicio_nueva,
    fechaFinNueva: r.mod_fecha_fin_nueva,
    diasHabilesNuevos: r.mod_dias_habiles_nuevos,
    motivo: r.mod_motivo,
    estado: r.mod_estado,
    aprobadorCorreo: r.mod_aprobador_correo,
    solicitanteEmail: r.mod_solicitante_email,
    decididaAt: r.mod_decidida_at,
    motivoRechazo: r.mod_motivo_rechazo,
    createdAt: r.mod_created_at,
  };
}

// ── Solicitudes ────────────────────────────────────────────────────────────

export const SELECT_SOLICITUD = `
  SELECT s.id, s.tipo, s.empleado_id, e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
         s.solicitante_email, s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
         -- ::float8 NO es cosmetico: desde que la columna es NUMERIC (para
         -- admitir el medio dia del historico), el driver la devolveria como
         -- STRING para no perder precision, y "5.0" romperia toda la aritmetica
         -- de la UI y de los correos. Cuatro digitos con un decimal caben de
         -- sobra en un double sin error de representacion observable.
         s.dias_habiles::float8 AS dias_habiles,
         -- to_char y no ::text: el driver devuelve un TIME como '09:00:00', y
         -- esos segundos se cuelan tal cual en el ISO que se le manda a Google
         -- y en el value de un <input type="time">, que solo entiende HH:MM.
         -- Es el mismo gotcha que el ::text de las fechas, con otra cara.
         to_char(s.hora_inicio, 'HH24:MI') AS hora_inicio,
         to_char(s.hora_fin,    'HH24:MI') AS hora_fin,
         s.observaciones, s.origen,
         s.comentarios, s.estado, s.aprobador_correo, s.segundo_aprobador_correo, s.informado_correo,
         -- ::text por lo mismo que las fechas de mas arriba: el driver devuelve
         -- timestamptz como objeto Date, y una comparacion lexicografica contra
         -- una cadena fallaria en silencio.
         s.primera_firma_at::text AS primera_firma_at,
         s.decidida_at::text AS decidida_at, s.motivo_rechazo, s.created_at::text AS created_at,
         s.anulada_at::text AS anulada_at,
         -- Sin ::text: es TEXT en la base, no una fecha ni un numero.
         s.evento_calendario_id,
         a.id AS adjunto_id, a.nombre_archivo, a.mime,
         -- octet_length y no el binario: las listas solo necesitan el tamano.
         octet_length(a.contenido) AS adjunto_bytes,
         e.copia_correo,
         ${COLS_MODIFICACION}
    FROM portal.solicitudes_ausencia s
    JOIN portal.empleados e ON e.id = s.empleado_id
    LEFT JOIN portal.solicitud_adjuntos a ON a.solicitud_id = s.id
    -- La propuesta VIVA, si la hay. El JOIN no puede multiplicar filas: el
    -- indice unico parcial ux_modificaciones_una_pendiente de la 024 admite
    -- como mucho una con estado 'pendiente' por solicitud. Si esa condicion
    -- desapareciera, las OCHO consultas que usan este SELECT empezarian a
    -- duplicar resultados a la vez.
    LEFT JOIN portal.solicitud_modificaciones m
           ON m.solicitud_id = s.id AND m.estado = 'pendiente'`;

export interface FilaSolicitudDb extends FilaModificacionJoinDb {
  id: string;
  tipo: TipoSolicitud;
  empleado_id: string;
  empleado_nombre: string;
  empleado_cargo: string | null;
  solicitante_email: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias_habiles: number;
  hora_inicio: string | null;
  hora_fin: string | null;
  observaciones: string | null;
  origen: Solicitud['origen'];
  comentarios: string | null;
  estado: Solicitud['estado'];
  aprobador_correo: string | null;
  segundo_aprobador_correo: string | null;
  informado_correo: string | null;
  primera_firma_at: string | null;
  decidida_at: string | null;
  motivo_rechazo: string | null;
  created_at: string;
  adjunto_id: string | null;
  nombre_archivo: string | null;
  mime: string | null;
  adjunto_bytes: number | null;
  copia_correo: string | null;
  anulada_at: string | null;
  evento_calendario_id: string | null;
}

export function aSolicitud(r: FilaSolicitudDb): Solicitud {
  const adjunto: Adjunto | null = r.adjunto_id
    ? {
        id: r.adjunto_id,
        nombreArchivo: r.nombre_archivo ?? '',
        mime: r.mime ?? '',
        bytes: r.adjunto_bytes ?? 0,
      }
    : null;
  return {
    id: r.id,
    tipo: r.tipo,
    empleadoId: r.empleado_id,
    empleadoNombre: r.empleado_nombre,
    empleadoCargo: r.empleado_cargo,
    solicitanteEmail: r.solicitante_email,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    diasHabiles: r.dias_habiles,
    horaInicio: r.hora_inicio,
    horaFin: r.hora_fin,
    observaciones: r.observaciones,
    origen: r.origen,
    comentarios: r.comentarios,
    estado: r.estado,
    aprobadorCorreo: r.aprobador_correo,
    segundoAprobadorCorreo: r.segundo_aprobador_correo,
    informadoCorreo: r.informado_correo,
    primeraFirmaAt: r.primera_firma_at,
    decididaAt: r.decidida_at,
    motivoRechazo: r.motivo_rechazo,
    createdAt: r.created_at,
    adjunto,
    copiaCorreo: r.copia_correo,
    // El cast es seguro por el `if`: en el LEFT JOIN, o vienen TODAS las
    // columnas del satélite o ninguna, así que `mod_id` decide por las demás.
    modificacionPendiente: r.mod_id ? aModificacion(r as FilaModificacionDb) : null,
    anuladaAt: r.anulada_at,
    eventoCalendarioId: r.evento_calendario_id,
  };
}

/**
 * Deja constancia de si esta solicitud es dueña de un evento VIVO en el
 * calendario.
 *
 * La columna no significa «alguna vez impusimos un id»: significa «ahora
 * mismo hay un evento en Google que responde a este id». `crear` la anota y
 * `borrar` la vacía, porque el evento que describía ya no existe. Las
 * solicitudes aprobadas antes de esto nunca la anotaron: llevan en Google un
 * id que inventó Google y que nadie apuntó, y por eso siguen pidiendo el
 * ajuste a mano. Ver `correccionDeCalendario` en notificaciones.ts.
 *
 * Va en la MISMA transacción que el INSERT del outbox: si el evento sale, la
 * marca cambia, y si hay ROLLBACK no cambia ninguna de las dos.
 */
export async function anotarEventoDeCalendario(
  client: PoolClient,
  solicitud: Solicitud,
  payload: PayloadEvento,
): Promise<void> {
  // La condicion se lee del PAYLOAD, no de una lista de eventos copiada aqui:
  // asi la marca se escribe exactamente cuando se emite la accion, y no puede
  // desincronizarse de construirPayload el dia que cambie el reparto de efectos.
  const cal = payload.calendario;
  if (cal?.accion !== 'crear' && cal?.accion !== 'borrar') return;
  // `borrar` la VACIA: la columna dice si hay evento vivo en Google, no si
  // alguna vez impusimos un id. Dejarla puesta tras un borrado hace que la
  // siguiente correccion mande un `actualizar` contra un evento que no existe,
  // y el IF de fallos esperables de n8n se lo traga como 404: en silencio.
  const id = cal.accion === 'crear' ? cal.eventId : null;
  await client.query(`UPDATE portal.solicitudes_ausencia SET evento_calendario_id = $2 WHERE id = $1`, [
    solicitud.id,
    id,
  ]);
  // La fila se leyo con SELECT_SOLICITUD ANTES de este UPDATE, asi que el objeto
  // que se devuelve llevaria un valor que dejo de ser cierto hace dos lineas. Y
  // este campo decide si Google se corrige solo: devolverlo obsoleto es
  // exactamente la clase de texto caducado que mas cara sale en esta app.
  solicitud.eventoCalendarioId = id;
}
