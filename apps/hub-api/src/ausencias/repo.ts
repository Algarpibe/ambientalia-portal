import type { Pool } from '@algarpibe/zoho-sync';
import type {
  Adjunto,
  Empleado,
  EventoOutbox,
  EventoPendiente,
  FilaEmpleado,
  PayloadEvento,
  Solicitud,
  TipoSolicitud,
} from './types.js';

// Acceso a datos de la app de ausencias. SQL crudo con parámetros posicionales,
// como el resto del repo (no hay ORM). Todas las tablas van cualificadas con
// `portal.` — la BD zoho-hub tiene un `public` ajeno.

// El tipo del cliente transaccional se deriva del Pool para no depender de un
// import directo de 'pg' (mismo truco que users.repository.ts).
type PoolClient = Awaited<ReturnType<Pool['connect']>>;

/** Ejecuta `fn` dentro de BEGIN/COMMIT; hace ROLLBACK ante cualquier error. */
async function withTransaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Empleados ──────────────────────────────────────────────────────────────

const COLS_EMPLEADO = `
  id, nombre_completo, correo, cargo, credencial,
  aprobador_correo, user_id, activo`;

interface FilaEmpleadoDb {
  id: string;
  nombre_completo: string;
  correo: string;
  cargo: string | null;
  credencial: number | null;
  aprobador_correo: string;
  user_id: string | null;
  activo: boolean;
}

function aEmpleado(r: FilaEmpleadoDb): Empleado {
  return {
    id: r.id,
    nombreCompleto: r.nombre_completo,
    correo: r.correo,
    cargo: r.cargo,
    credencial: r.credencial,
    aprobadorCorreo: r.aprobador_correo,
    userId: r.user_id,
    activo: r.activo,
  };
}

/**
 * El empleado de un usuario del portal. Busca primero por `user_id` (el vínculo
 * explícito) y, si no lo hay, por correo: los empleados se importan desde la
 * hoja de Google antes de que existan sus cuentas, así que el `user_id` puede
 * estar todavía sin rellenar.
 */
export async function empleadoDeUsuario(db: Pool, userId: string | null, email: string): Promise<Empleado | null> {
  const { rows } = await db.query(
    `SELECT ${COLS_EMPLEADO} FROM portal.empleados
      WHERE activo AND (($1::uuid IS NOT NULL AND user_id = $1::uuid) OR lower(correo) = lower($2))
      ORDER BY (user_id IS NOT NULL) DESC
      LIMIT 1`,
    [userId, email],
  );
  return rows.length ? aEmpleado(rows[0] as FilaEmpleadoDb) : null;
}

/**
 * True si alguien tiene a este correo como aprobador. Se pregunta por el
 * maestro y no por las solicitudes vivas: quien aprueba sigue siendo aprobador
 * aunque ahora mismo no tenga nada pendiente, y la pestaña de la bandeja debe
 * estar ahí igual (si no, parecería que la función se ha perdido).
 */
export async function esAprobadorDeAlguien(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT 1 FROM portal.empleados WHERE activo AND lower(aprobador_correo) = lower($1) LIMIT 1',
    [email],
  );
  return rows.length > 0;
}

export async function listarEmpleados(db: Pool): Promise<Empleado[]> {
  const { rows } = await db.query(`SELECT ${COLS_EMPLEADO} FROM portal.empleados ORDER BY nombre_completo`);
  return (rows as FilaEmpleadoDb[]).map(aEmpleado);
}

/**
 * Importa/actualiza el maestro desde las filas de la hoja `consolidado`.
 * Upsert por correo, para que reimportar la hoja sea seguro. Además vincula
 * `user_id` con la cuenta del portal cuyo email coincida, si ya existe.
 */
export async function importarEmpleados(db: Pool, filas: FilaEmpleado[]): Promise<{ importados: number }> {
  if (filas.length === 0) return { importados: 0 };
  const { rowCount } = await db.query(
    `INSERT INTO portal.empleados (nombre_completo, correo, cargo, credencial, aprobador_correo, user_id)
     SELECT f.nombre_completo,
            lower(f.correo),
            NULLIF(f.cargo, ''),
            f.credencial,
            COALESCE(NULLIF(f.aprobador_correo, ''), 'comercial@ambientalia.com.co'),
            u.id
       FROM jsonb_to_recordset($1::jsonb) AS f(
              nombre_completo text, correo text, cargo text,
              credencial int, aprobador_correo text)
       LEFT JOIN portal.users u ON lower(u.email) = lower(f.correo)
     ON CONFLICT (correo) DO UPDATE SET
       nombre_completo  = EXCLUDED.nombre_completo,
       cargo            = EXCLUDED.cargo,
       credencial       = EXCLUDED.credencial,
       aprobador_correo = EXCLUDED.aprobador_correo,
       -- Nunca se borra un vínculo ya establecido: si la cuenta del portal aún
       -- no existía al importar, EXCLUDED.user_id es NULL y se conserva el actual.
       user_id          = COALESCE(EXCLUDED.user_id, portal.empleados.user_id),
       activo           = TRUE`,
    [
      JSON.stringify(
        filas.map((f) => ({
          nombre_completo: f.nombreCompleto,
          correo: f.correo,
          cargo: f.cargo ?? '',
          credencial: f.credencial ?? null,
          aprobador_correo: f.aprobadorCorreo ?? '',
        })),
      ),
    ],
  );
  return { importados: rowCount ?? 0 };
}

// ── Solicitudes ────────────────────────────────────────────────────────────

const SELECT_SOLICITUD = `
  SELECT s.id, s.tipo, s.empleado_id, e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
         s.solicitante_email, s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
         s.dias_habiles, s.comentarios, s.estado, s.aprobador_correo,
         s.decidida_at::text AS decidida_at, s.motivo_rechazo, s.created_at::text AS created_at,
         a.id AS adjunto_id, a.nombre_archivo, a.mime, a.drive_file_id,
         octet_length(a.contenido) AS adjunto_bytes
    FROM portal.solicitudes_ausencia s
    JOIN portal.empleados e ON e.id = s.empleado_id
    LEFT JOIN portal.solicitud_adjuntos a ON a.solicitud_id = s.id`;

interface FilaSolicitudDb {
  id: string;
  tipo: TipoSolicitud;
  empleado_id: string;
  empleado_nombre: string;
  empleado_cargo: string | null;
  solicitante_email: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias_habiles: number;
  comentarios: string | null;
  estado: Solicitud['estado'];
  aprobador_correo: string | null;
  decidida_at: string | null;
  motivo_rechazo: string | null;
  created_at: string;
  adjunto_id: string | null;
  nombre_archivo: string | null;
  mime: string | null;
  drive_file_id: string | null;
  adjunto_bytes: number | null;
}

function aSolicitud(r: FilaSolicitudDb): Solicitud {
  const adjunto: Adjunto | null = r.adjunto_id
    ? {
        id: r.adjunto_id,
        nombreArchivo: r.nombre_archivo ?? '',
        mime: r.mime ?? '',
        bytes: r.adjunto_bytes ?? 0,
        driveFileId: r.drive_file_id,
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
    comentarios: r.comentarios,
    estado: r.estado,
    aprobadorCorreo: r.aprobador_correo,
    decididaAt: r.decidida_at,
    motivoRechazo: r.motivo_rechazo,
    createdAt: r.created_at,
    adjunto,
  };
}

export interface DatosInsercion {
  tipo: TipoSolicitud;
  empleadoId: string;
  solicitanteEmail: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  comentarios: string | null;
  estado: Solicitud['estado'];
  aprobadorCorreo: string | null;
}

/**
 * Crea la solicitud, su adjunto y el evento de outbox **en una transacción**:
 * una solicitud guardada sin su evento nunca notificaría a nadie, y un evento
 * sin solicitud es basura que n8n reintentaría en bucle.
 */
export async function crearSolicitud(
  db: Pool,
  datos: DatosInsercion,
  adjunto: { nombreArchivo: string; mime: string; contenido: Buffer } | null,
  evento: EventoOutbox,
  construirPayload: (solicitud: Solicitud) => PayloadEvento,
): Promise<Solicitud> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO portal.solicitudes_ausencia
         (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin,
          dias_habiles, comentarios, estado, aprobador_correo)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9)
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

    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, evento, JSON.stringify(construirPayload(solicitud))],
    );

    return solicitud;
  });
}

export async function solicitudesDeEmpleado(db: Pool, empleadoId: string): Promise<Solicitud[]> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE s.empleado_id = $1 ORDER BY s.created_at DESC`, [
    empleadoId,
  ]);
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

/**
 * Las solicitudes que le toca decidir a `aprobadorCorreo`. Un admin (`todas`)
 * ve las de todo el mundo: es quien destraba una aprobación bloqueada.
 */
export async function solicitudesPendientes(db: Pool, aprobadorCorreo: string, todas: boolean): Promise<Solicitud[]> {
  const { rows } = await db.query(
    `${SELECT_SOLICITUD}
      WHERE s.estado = 'pendiente' AND ($2::boolean OR lower(s.aprobador_correo) = lower($1))
      ORDER BY s.created_at`,
    [aprobadorCorreo, todas],
  );
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

export async function solicitudPorId(db: Pool, id: string): Promise<Solicitud | null> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
  return rows.length ? aSolicitud(rows[0] as FilaSolicitudDb) : null;
}

/**
 * Registra la decisión y encola su notificación, en una transacción.
 *
 * El `WHERE estado = 'pendiente'` es lo que hace la operación idempotente sin
 * bloqueos: dos clics en «Aprobar» a la vez, o un reintento del navegador, y
 * solo el primero actualiza. El segundo no encuentra fila y el servicio lo
 * traduce a 409, en vez de mandar dos correos contradictorios.
 */
export async function decidirSolicitud(
  db: Pool,
  id: string,
  aprueba: boolean,
  motivo: string | null,
  aprobadorUserId: string | null,
  construirPayload: (solicitud: Solicitud) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.solicitudes_ausencia
          SET estado = $2, motivo_rechazo = $3, aprobador_user_id = $4, decidida_at = now()
        WHERE id = $1 AND estado = 'pendiente'
        RETURNING id`,
      [id, aprueba ? 'aprobada' : 'rechazada', aprueba ? null : motivo, aprobadorUserId],
    );
    // Sin fila = ya estaba decidida (o no existe). No es un error de servidor:
    // el servicio lo traduce a 409 y no se encola ninguna notificación.
    if (rows.length === 0) return null;

    const { rows: actualizada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
    const solicitud = aSolicitud(actualizada[0] as FilaSolicitudDb);

    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, aprueba ? 'aprobada' : 'rechazada', JSON.stringify(construirPayload(solicitud))],
    );

    return solicitud;
  });
}

// ── Adjuntos ───────────────────────────────────────────────────────────────

export interface AdjuntoCompleto {
  solicitudId: string;
  solicitanteEmail: string;
  aprobadorCorreo: string | null;
  nombreArchivo: string;
  mime: string;
  contenido: Buffer;
}

export async function adjuntoPorId(db: Pool, id: string): Promise<AdjuntoCompleto | null> {
  const { rows } = await db.query(
    `SELECT a.solicitud_id, s.solicitante_email, s.aprobador_correo,
            a.nombre_archivo, a.mime, a.contenido
       FROM portal.solicitud_adjuntos a
       JOIN portal.solicitudes_ausencia s ON s.id = a.solicitud_id
      WHERE a.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const r = rows[0] as {
    solicitud_id: string;
    solicitante_email: string;
    aprobador_correo: string | null;
    nombre_archivo: string;
    mime: string;
    contenido: Buffer;
  };
  return {
    solicitudId: r.solicitud_id,
    solicitanteEmail: r.solicitante_email,
    aprobadorCorreo: r.aprobador_correo,
    nombreArchivo: r.nombre_archivo,
    mime: r.mime,
    contenido: r.contenido,
  };
}

export async function marcarAdjuntoEnDrive(db: Pool, adjuntoId: string, driveFileId: string): Promise<void> {
  await db.query('UPDATE portal.solicitud_adjuntos SET drive_file_id = $2 WHERE id = $1', [adjuntoId, driveFileId]);
}

// ── Outbox ─────────────────────────────────────────────────────────────────

/**
 * Los eventos aún no ejecutados, del más antiguo al más nuevo.
 *
 * Sirve el evento **sin** marcarlo: el estado solo avanza en `confirmarEventos`.
 * Si Gmail falla a mitad, el ciclo siguiente lo vuelve a servir. El precio es
 * que un fallo DESPUÉS de enviar el correo puede duplicarlo; se prefiere un
 * correo repetido a una solicitud que nadie ve. `intentos` se incrementa aquí
 * para poder detectar en la BD un evento que lleva reintentándose sin éxito.
 */
export async function eventosPendientes(db: Pool, limite = 20): Promise<EventoPendiente[]> {
  const { rows } = await db.query(
    `UPDATE portal.ausencias_outbox o
        SET intentos = o.intentos + 1
      WHERE o.id IN (
              SELECT id FROM portal.ausencias_outbox
               WHERE enviado_at IS NULL ORDER BY id LIMIT $1)
      RETURNING o.id, o.evento, o.solicitud_id, o.intentos, o.payload`,
    [limite],
  );
  return (rows as { id: string; evento: EventoOutbox; solicitud_id: string; intentos: number; payload: PayloadEvento }[])
    .map((r) => ({
      id: Number(r.id),
      evento: r.evento,
      solicitudId: r.solicitud_id,
      intentos: r.intentos,
      payload: r.payload,
    }))
    .sort((a, b) => a.id - b.id);
}

/** Marca como enviados los ids que n8n confirma. Idempotente. */
export async function confirmarEventos(db: Pool, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await db.query(
    'UPDATE portal.ausencias_outbox SET enviado_at = now() WHERE id = ANY($1::bigint[]) AND enviado_at IS NULL',
    [ids],
  );
  return rowCount ?? 0;
}
