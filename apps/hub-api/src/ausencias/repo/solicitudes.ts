import type { Pool } from '@algarpibe/zoho-sync';
import type {
  EventoModificacion,
  EventoSolicitud,
  Modificacion,
  PayloadEvento,
  Solicitud,
  TipoSolicitud,
  Transicion,
} from '../types.js';
import { withTransaction, type PoolClient } from './comun.js';
import {
  SELECT_MODIFICACION,
  SELECT_SOLICITUD,
  aModificacion,
  aSolicitud,
  anotarEventoDeCalendario,
  type FilaModificacionDb,
  type FilaSolicitudDb,
} from './filas.js';

// ARQ-612 — el ciclo de vida de una solicitud, sacado de repo.ts tal cual:
// darla de alta (con su adjunto y su evento de outbox en la misma
// transacción), las bandejas que la leen, decidirla y retirarla. Las consultas
// base y la traducción de la fila viven en filas.ts porque las comparten las
// modificaciones y las correcciones de admin. repo.ts lo reexporta: el resto
// del código lo sigue llamando como `repo.*` (lo vigila barril.test.ts).

export interface DatosInsercion {
  tipo: TipoSolicitud;
  empleadoId: string;
  solicitanteEmail: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  /** Solo en un permiso de un día. Las dos o ninguna: lo exige el CHECK. */
  horaInicio: string | null;
  horaFin: string | null;
  comentarios: string | null;
  estado: Solicitud['estado'];
  aprobadorCorreo: string | null;
  /** Copia congelada: un cambio de organigrama no mueve una solicitud en vuelo. */
  segundoAprobadorCorreo: string | null;
  /** Congelado por lo mismo que los firmantes: nace del árbol, no de un ajuste. */
  informadoCorreo: string | null;
}

/**
 * Crea la solicitud, su adjunto y el evento de outbox **en una transacción**:
 * una solicitud guardada sin su evento nunca notificaría a nadie, y un evento
 * sin solicitud es basura que n8n reintentaría en bucle.
 *
 * El alta del servidor NO pasa por aquí sino por `insertarSolicitud`, dentro de
 * `conCandadoDelEmpleado` (DATA-336). Esta se queda para quien ya sabe que no
 * compite con nadie, como la siembra de los tests.
 */
export async function crearSolicitud(
  db: Pool,
  datos: DatosInsercion,
  adjunto: { nombreArchivo: string; mime: string; contenido: Buffer } | null,
  eventos: EventoSolicitud[],
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
): Promise<Solicitud> {
  return withTransaction(db, (client) => insertarSolicitud(client, datos, adjunto, eventos, construirPayload));
}

/** Lo que hace `crearSolicitud`, sobre una transacción que ya abrió otro. */
export async function insertarSolicitud(
  client: PoolClient,
  datos: DatosInsercion,
  adjunto: { nombreArchivo: string; mime: string; contenido: Buffer } | null,
  eventos: EventoSolicitud[],
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
): Promise<Solicitud> {
  const { rows } = await client.query(
    `INSERT INTO portal.solicitudes_ausencia
       (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin,
        dias_habiles, comentarios, estado, aprobador_correo, segundo_aprobador_correo,
        informado_correo, hora_inicio, hora_fin)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12::time, $13::time)
     RETURNING id`,
    [
      datos.tipo,
      datos.empleadoId,
      datos.solicitanteEmail,
      datos.fechaInicio,
      datos.fechaFin,
      datos.diasHabiles,
      datos.comentarios,
      datos.estado,
      datos.aprobadorCorreo,
      datos.segundoAprobadorCorreo,
      datos.informadoCorreo,
      datos.horaInicio,
      datos.horaFin,
    ],
  );
  const id = (rows[0] as { id: string }).id;

  if (adjunto) {
    await client.query(
      `INSERT INTO portal.solicitud_adjuntos (solicitud_id, nombre_archivo, mime, contenido)
       VALUES ($1, $2, $3, $4)`,
      [id, adjunto.nombreArchivo, adjunto.mime, adjunto.contenido],
    );
  }

  const { rows: creada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
  const solicitud = aSolicitud(creada[0] as FilaSolicitudDb);

  // El orden importa: el outbox se sirve por `id` ascendente, así que el
  // acuse al solicitante sale antes que el aviso a quien aprueba.
  for (const evento of eventos) {
    const payload = construirPayload(solicitud, evento);
    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, evento, JSON.stringify(payload)],
    );
    await anotarEventoDeCalendario(client, solicitud, payload);
  }

  return solicitud;
}

export async function solicitudesDeEmpleado(db: Pool, empleadoId: string): Promise<Solicitud[]> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE s.empleado_id = $1 ORDER BY s.created_at DESC`, [
    empleadoId,
  ]);
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

/**
 * Las solicitudes que le toca decidir a `aprobadorCorreo` **ahora**. Un admin
 * (`todas`) ve las de todo el mundo: es quien destraba una aprobación bloqueada.
 *
 * El filtro es por TURNO, no por «aparezco en la solicitud»: en `pendiente` solo
 * la ve quien firma primero, y en `pendiente_2` solo quien firma después. Si
 * fuera un OR de los dos correos, el segundo aprobador vería —y podría firmar—
 * solicitudes que su jefe intermedio todavía no ha visto.
 */
export async function solicitudesPendientes(db: Pool, aprobadorCorreo: string, todas: boolean): Promise<Solicitud[]> {
  const { rows } = await db.query(
    `${SELECT_SOLICITUD}
      WHERE s.estado IN ('pendiente', 'pendiente_2')
        AND ($2::boolean
             OR (s.estado = 'pendiente'   AND lower(s.aprobador_correo)         = lower($1))
             OR (s.estado = 'pendiente_2' AND lower(s.segundo_aprobador_correo) = lower($1)))
      ORDER BY s.created_at`,
    [aprobadorCorreo, todas],
  );
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

// Aquí estaba `solicitudesDecididas`, el historial del aprobador: lo ya cerrado
// que le tocaba firmar a un correo. Lo sustituye `movimientos` (al final del
// fichero), que enseña ese mismo rastro y el de toda su rama, con las
// anulaciones y los cambios que esta consulta no alcanzaba. Su `ORDER BY`
// sobrevive en `porFechaDeCierre`, con el porqué del `NULLS LAST` intacto.

/**
 * Las solicitudes que llevan un PDF, de cualquiera y en cualquier estado.
 *
 * Sin acotar por persona: quien llega aquí ya pasó el guard de administración del
 * servicio. Reutiliza `SELECT_SOLICITUD`, así que el binario NO viaja — solo su
 * `octet_length`.
 *
 * Nota: `solicitud_adjuntos` no tiene UNIQUE sobre `solicitud_id`. Hoy no puede
 * haber dos, porque el alta inserta uno como mucho, pero si algún día los
 * hubiera, esta consulta duplicaría la fila y sería aquí donde se vería.
 */
/**
 * Quienes tienen a `$1` como JEFE INMEDIATO —la primera firma—, y nadie más.
 *
 * ⚠️ UN SOLO NIVEL, más estrecho que `ramaDeDosNiveles`, y la diferencia es
 * deliberada. Aquel sirve al Calendario y al Registro general, donde el dato es
 * «fulano no está»; este sirve a los SOPORTES, que son PDF médicos. Quien firma
 * una solicitud necesita abrir su soporte; el jefe de su jefe no ha necesitado
 * abrirlo para nada, y con dos niveles vería los informes médicos de una
 * organización entera sin haber firmado una sola de esas solicitudes.
 *
 * Que un permiso sea MÁS estrecho que el del calendario no es una incoherencia:
 * es que el dato de debajo es más sensible.
 *
 * Asume que `portal.empleados` va aliasada como `e`, igual que su hermana.
 */
export function equipoDirecto(): string {
  return `($1::text IS NULL OR lower(e.aprobador_correo) = lower($1))`;
}

export async function solicitudesConAdjunto(db: Pool, soloDe: string | null): Promise<Solicitud[]> {
  const { rows } = await db.query(
    `${SELECT_SOLICITUD}
      WHERE a.id IS NOT NULL
        AND ${equipoDirecto()}
      ORDER BY s.fecha_inicio DESC`,
    [soloDe],
  );
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

/**
 * ¿Tiene `correoEmpleado` a `correoJefe` como jefe inmediato?
 *
 * ⚠️ Existe para que `GET /ausencias/adjuntos/:id` aplique EL MISMO recorte que
 * la lista. Sin ella, acotar la pestaña no serviría de nada: la ruta del adjunto
 * suelto seguiría sirviendo cualquier PDF a quien tuviera la llave, y bastaría
 * con conocer la URL. Una pantalla que esconde lo que la API entrega no protege
 * nada; es la versión incómoda del mismo acceso.
 *
 * NO exige que el empleado esté activo, al contrario que las listas que usan
 * estos predicados para pintar plantilla: los soportes de quien se fue siguen
 * existiendo y su jefe sigue necesitando abrirlos.
 */
export async function esDeSuEquipoDirecto(
  db: Pool,
  correoJefe: string,
  correoEmpleado: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados e
      WHERE lower(e.correo) = lower($2)
        AND ${equipoDirecto()}`,
    [correoJefe, correoEmpleado],
  );
  return rows.length > 0;
}

/**
 * Una solicitud por su id, con lo que le cuelga del `SELECT_SOLICITUD`.
 *
 * Acepta `PoolClient` además de `Pool` por lo mismo que `solapeDe`: cuando
 * `actualizarSolicitud` la usa para releer lo que acaba de escribir, tiene que ir
 * por la conexión de la transacción o no vería el UPDATE sin confirmar y
 * devolvería la fila de antes.
 */
export async function solicitudPorId(db: Pool | PoolClient, id: string): Promise<Solicitud | null> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
  return rows.length ? aSolicitud(rows[0] as FilaSolicitudDb) : null;
}

/**
 * Registra la decisión y encola su notificación, en una transacción.
 *
 * El `WHERE estado = $N` es lo que hace la operación idempotente sin bloqueos:
 * dos clics en «Aprobar» a la vez, o un reintento del navegador, y solo el
 * primero actualiza. El segundo no encuentra fila y el servicio lo traduce a 409,
 * en vez de mandar dos correos contradictorios.
 *
 * ⚠️ `estadoEsperado` es el estado que el servicio LEYÓ, y funciona como testigo
 * de concurrencia optimista. No sustituirlo por un `IN ('pendiente','pendiente_2')`
 * con un CASE para el destino: sería igual de atómico pero destruiría el 409, y un
 * doble clic del jefe inmediato encadenaría `pendiente → pendiente_2 → aprobada`
 * con una sola persona firmando las dos veces.
 *
 * Lo vigila `repo.testigos.db.test.ts`: dos llamadas con el mismo
 * `estadoEsperado` —el doble clic— y la segunda tiene que devolver `null` sin
 * encolar un segundo correo. Falsado sustituyendo el testigo por un `IN`: el
 * test se pone rojo. Corre en el cuarto portón, `npm run test:db`.
 */
export async function decidirSolicitud(
  db: Pool,
  id: string,
  estadoEsperado: Solicitud['estado'],
  transicion: Transicion,
  motivo: string | null,
  userId: string | null,
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
  /**
   * El segundo constructor, para el aviso de la propuesta que caduca. Va aparte
   * del de arriba y no fundido en uno polimórfico porque son dos payloads con
   * dos formas distintas — uno habla de la solicitud y el otro de la propuesta—,
   * y fundirlos obligaría a discriminar por el nombre del evento dentro.
   */
  construirPayloadCaducada: (s: Solicitud, m: Modificacion, evento: EventoModificacion) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.solicitudes_ausencia
          SET estado                = $2,
              motivo_rechazo        = $3,
              primera_firma_user_id = CASE WHEN $5::boolean THEN $4 ELSE primera_firma_user_id END,
              primera_firma_at      = CASE WHEN $5::boolean THEN now() ELSE primera_firma_at END,
              aprobador_user_id     = CASE WHEN $6::boolean THEN $4 ELSE aprobador_user_id END,
              decidida_at           = CASE WHEN $6::boolean THEN now() ELSE decidida_at END
        WHERE id = $1 AND estado = $7
        RETURNING id`,
      [
        id,
        transicion.estado,
        motivo,
        userId,
        transicion.esPrimeraFirma,
        transicion.esDecisionFinal,
        estadoEsperado,
      ],
    );
    // Sin fila = ya la decidió otro (o no existe). No es un error de servidor:
    // el servicio lo traduce a 409 y no se encola ninguna notificación.
    if (rows.length === 0) return null;

    const { rows: actualizada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
    const solicitud = aSolicitud(actualizada[0] as FilaSolicitudDb);

    const payload = construirPayload(solicitud, transicion.evento);
    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, transicion.evento, JSON.stringify(payload)],
    );
    await anotarEventoDeCalendario(client, solicitud, payload);

    await caducarPropuestaViva(client, id, solicitud, construirPayloadCaducada);

    return solicitud;
  });
}

/**
 * Cierra la petición de cambio que estuviera viva sobre esta solicitud, porque
 * acaba de dejar de poder aplicarse.
 *
 * ⚠️ Esto NO es una decisión de producto que se pueda discutir aparte: la
 * propuesta ya estaba muerta antes de existir esta función. El `TESTIGO_SOLICITUD`
 * de `decidirModificacion` compara el ESTADO de la solicitud, así que en cuanto
 * la solicitud se mueve —y firmarla la mueve SIEMPRE, incluso el paso de
 * `pendiente` a `pendiente_2`— aprobarla contesta 409 y nada la revive. Lo único
 * que cambia aquí es que el sistema lo reconoce en vez de dejarla `pendiente`
 * para siempre.
 *
 * Y lo que arregla no es cosmético. El índice único parcial de la 024 solo admite
 * UNA propuesta viva por solicitud, así que esa fila muerta dejaba al trabajador
 * sin poder pedir otro cambio sobre esa misma solicitud, con un 409 que hablaba
 * de una petición que él daba por perdida.
 *
 * Va DENTRO de la transacción de la firma, y con su aviso en el outbox, por lo
 * mismo que el resto: si se hiciera después y el proceso se cayera entre medias,
 * la propuesta quedaría caducada sin que nadie se lo hubiera dicho a nadie.
 */
async function caducarPropuestaViva(
  client: PoolClient,
  solicitudId: string,
  solicitud: Solicitud,
  construirPayload: (s: Solicitud, m: Modificacion, evento: EventoModificacion) => PayloadEvento,
): Promise<void> {
  const { rows } = await client.query(
    `UPDATE portal.solicitud_modificaciones
        SET estado = 'caducada'
      WHERE solicitud_id = $1 AND estado = 'pendiente'
      RETURNING id`,
    [solicitudId],
  );
  // Lo normal: no había ninguna viva y no hay nada que avisar.
  if (rows.length === 0) return;

  // Se relee con el SELECT común en vez de construirla desde el RETURNING: es lo
  // que garantiza que el correo hable de la MISMA forma de propuesta que el
  // resto del módulo, con sus `::text` incluidos.
  const { rows: cerrada } = await client.query(`${SELECT_MODIFICACION} WHERE m.id = $1`, [
    (rows[0] as { id: string }).id,
  ]);
  const modificacion = aModificacion(cerrada[0] as FilaModificacionDb);

  await client.query(
    `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
    [
      solicitudId,
      'modificacion_caducada',
      JSON.stringify(construirPayload(solicitud, modificacion, 'modificacion_caducada')),
    ],
  );
}

/**
 * El dueño retira su propia solicitud, antes de que nadie la haya firmado.
 *
 * La deja en `rechazada` + `anulada_at`, que es el MISMO estado terminal en el
 * que la dejaría una anulación aprobada. Reutilizarlo y no estrenar un
 * `'retirada'` es deliberado: `estado <> 'rechazada'` está repartido por media
 * docena de consultas —el calendario, el solape, el saldo— y un estado nuevo
 * tendría que añadirse a todas ellas, con el fallo cayendo del lado de contar
 * como ausencia unos días que ya nadie disfruta.
 *
 * ⚠️ El testigo del WHERE es lo único que impide la carrera contra la firma. Las
 * dos condiciones hacen falta y no sobra ninguna:
 *  - `estado = 'pendiente'`: si el jefe firma entre el SELECT del servicio y
 *    este UPDATE, aquí ya no hay fila y gana él. Cero filas → 409, igual que en
 *    `decidirSolicitud`.
 *  - `primera_firma_at IS NULL`: cinturón sobre lo mismo por otra vía. Un admin
 *    puede devolver una solicitud a `pendiente` con el PATCH del registro sin
 *    borrar esa marca, y entonces «pendiente» convive con una firma YA DADA.
 *    Retirarla ahí borraría el visto bueno del jefe inmediato sin decírselo.
 *
 * NO se toca `decidida_at` ni `aprobador_user_id`: no ha decidido nadie. El
 * registro lo enseña como anulada y sin decisor, que es exactamente lo que pasó
 * — y es lo que distingue una retirada de una anulación firmada por un jefe.
 */
export async function retirarSolicitud(
  db: Pool,
  id: string,
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.solicitudes_ausencia
          SET estado = 'rechazada', anulada_at = now()
        WHERE id = $1 AND estado = 'pendiente' AND primera_firma_at IS NULL
        RETURNING id`,
      [id],
    );
    if (rows.length === 0) return null;

    const { rows: actualizada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
    const solicitud = aSolicitud(actualizada[0] as FilaSolicitudDb);

    // Sin `anotarEventoDeCalendario`: una `pendiente` nunca creó evento, así que
    // no hay id que apuntar ni nada que borrar en Google.
    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, 'retirada', JSON.stringify(construirPayload(solicitud, 'retirada'))],
    );

    return solicitud;
  });
}
