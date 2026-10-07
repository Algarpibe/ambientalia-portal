/**
 * Lecturas de la fuente PRINCIPAL de la agenda: la base `desk` de Desk 2.0.
 * Sólo `SELECT`, por la conexión de db-desk2.ts. Quien decide si se usa esto o
 * la réplica es fuente.ts; aquí no se captura ningún error.
 *
 * Tablas y columnas, comprobadas contra el código de Desk 2.0 (repositorio
 * aparte, `Desk2:` = C:\dev\Desk_2_R1.023, HEAD 1bf414a; sólo se leyó):
 *
 *   desk.tickets                 Desk2:packages/zoho-sync/src/db/schema.sql:20-43
 *     id                         schema.sql:21  (texto; `app-<uuid>` en los nacidos en la app)
 *     number                     schema.sql:22
 *     status, status_type,
 *     priority, classification   schema.sql:23
 *     created_time               schema.sql:26
 *     tipo_servicio              schema.sql:28
 *     fecha_creacion_ticket,
 *     fecha_remision_entrada     schema.sql:32
 *     synced_at                  schema.sql:42
 *     prioridad_en_app_at        schema.sql:710 (la pone prioridadCliente.ts:118 al fijarla en la app)
 *   desk.ticket_transitions      schema.sql:57-61
 *     id, ticket_id              schema.sql:58  (ticket_id = tickets.id, no el número)
 *     to_status                  schema.sql:59
 *     performed_at               schema.sql:60
 *   public.calendario_cierres    schema.sql:478-483
 *     fecha                      schema.sql:479 (la lee Desk2:apps/desk/server/db/calendarioCierres.ts:32)
 *
 * El esquema va escrito (`desk.` / `public.`): en schema.sql las tablas de
 * tickets van sin calificar porque Desk 2.0 conecta con
 * `search_path=desk,public` (Desk2:packages/zoho-sync/src/db/pool.ts:5) y su
 * migración las deja en `desk` (Desk2:packages/zoho-sync/src/db/migrate.ts:117).
 * Esta conexión no toca el `search_path`.
 */

import type { DbLectura, FilaTicket } from './fuente.js';

/**
 * Tickets sin cerrar (el mismo criterio que la réplica: `status_type` distinto
 * de 'Closed').
 *
 * · `prioridad`: sólo la fijada en la app (`prioridad_en_app_at` relleno); el
 *   `High` / `Low` que viene de Zoho no se usa (D1).
 * · `llegada_ms`: el `performed_at` de la ÚLTIMA transición cuyo `to_status`
 *   es el estado de ahora, la misma regla que `entradasActuales`
 *   (Desk2:apps/desk/server/db/sla.ts:78-102), con el mismo desempate por id.
 *   NULL si el ticket no se ha movido desde la app.
 * · `asunto` y `codigo_servicio` van siempre NULL: aquí el flujo sale de
 *   `classification` y no hace falta leer nada más del ticket (D11).
 * · Los instantes viajan en milisegundos y las fechas como texto: sin depender
 *   del parser de fechas del driver.
 */
const SQL_TICKETS = `
     SELECT t.number AS numero, t.status AS estado, t.status_type AS tipo_estado,
            t.classification AS clasificacion, t.tipo_servicio,
            t.fecha_remision_entrada::text AS remision_entrada,
            COALESCE(t.fecha_creacion_ticket, (t.created_time AT TIME ZONE 'America/Bogota')::date)::text AS fecha_creacion,
            CASE WHEN t.prioridad_en_app_at IS NOT NULL THEN t.priority END AS prioridad,
            (SELECT (EXTRACT(EPOCH FROM tr.performed_at) * 1000)::float8
               FROM desk.ticket_transitions tr
              WHERE tr.ticket_id = t.id AND tr.to_status = t.status
              ORDER BY tr.performed_at DESC, tr.id DESC
              LIMIT 1) AS llegada_ms,
            NULL::text AS asunto, NULL::text AS codigo_servicio
       FROM desk.tickets t
      WHERE t.status_type IS DISTINCT FROM 'Closed'
      ORDER BY t.number`;

export async function leerTicketsDesk2(db: DbLectura): Promise<FilaTicket[]> {
  const { rows } = await db.query(SQL_TICKETS);
  return rows;
}

/** Cierres de empresa del tramo, ambos días incluidos, como AAAA-MM-DD. */
export async function leerCierresDesk2(db: DbLectura, desde: string, hasta: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT fecha::text AS fecha
       FROM public.calendario_cierres
      WHERE fecha BETWEEN $1::date AND $2::date
      ORDER BY fecha`,
    [desde, hasta],
  );
  return rows.map((r) => String(r.fecha));
}

/**
 * El máximo de `synced_at` de TODA la tabla, en milisegundos (D13). Los
 * tickets nacidos en la app no tienen fecha de sincronización y no lo alteran.
 *
 * Es también la SONDA de `estadoFuente()`, así que en la misma sentencia
 * nombra (sin traer ninguna fila: `WHERE false`) todo lo que leen las otras
 * dos consultas. Postgres comprueba tablas, columnas y permisos aunque no
 * devuelva nada: si a la base le falta algo, o al rol un permiso, esto falla
 * igual que fallarían los tickets, y el estado no dice «principal» mientras
 * los tickets salen de la réplica.
 */
export async function ultimaSincronizacionDesk2(db: DbLectura): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT (EXTRACT(EPOCH FROM max(synced_at)) * 1000)::float8 AS ms,
            (SELECT count(*) FROM (${SQL_TICKETS}) q WHERE false) AS sonda_tickets,
            (SELECT count(*) FROM public.calendario_cierres WHERE false) AS sonda_cierres
       FROM desk.tickets`,
  );
  return rows[0]?.ms == null ? null : Number(rows[0].ms);
}
