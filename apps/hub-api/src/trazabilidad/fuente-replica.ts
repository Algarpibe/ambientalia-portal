/**
 * Lecturas del RESPALDO de la agenda: la réplica `desk.tickets` de zoho-hub,
 * la que ya leen «Servicios» y el cruce de equipos (repo.ts). La escribe el
 * worker de zoho-hub; hub-api sólo la lee. Devuelve las mismas columnas que
 * fuente-desk2.ts, con NULL en lo que la réplica no tiene.
 */

import type { DbLectura, FilaTicket } from './fuente.js';

/**
 * Tickets sin cerrar de la réplica.
 *
 * · `clasificacion` y `remision_entrada` se piden por `to_jsonb(t)->>…`: si la
 *   réplica trae la columna se lee, y si no la tiene sale NULL en vez de un
 *   error (D12: «la misma regla si trae el campo»). Hoy vienen vacías.
 * · `prioridad` es siempre NULL: la única que vale es la fijada en Desk 2.0,
 *   y la réplica no sabe cuál es (D1).
 * · `llegada_ms` es siempre NULL: la réplica no tiene transiciones. La
 *   llegada aproximada sale del historial del portal, que no es de este módulo.
 */
export async function leerTicketsReplica(db: DbLectura): Promise<FilaTicket[]> {
  const { rows } = await db.query(
    `SELECT t.number AS numero, t.status AS estado, t.status_type AS tipo_estado,
            to_jsonb(t)->>'classification' AS clasificacion, t.tipo_servicio,
            to_jsonb(t)->>'fecha_remision_entrada' AS remision_entrada,
            COALESCE(t.fecha_creacion_ticket, (t.created_time AT TIME ZONE 'America/Bogota')::date)::text AS fecha_creacion,
            NULL::text AS prioridad,
            NULL::float8 AS llegada_ms
       FROM desk.tickets t
      WHERE t.status_type IS DISTINCT FROM 'Closed'
      ORDER BY t.number`,
  );
  return rows;
}

/** El máximo de `synced_at` de toda la réplica, en milisegundos (D13). */
export async function ultimaSincronizacionReplica(db: DbLectura): Promise<number | null> {
  const { rows } = await db.query(`SELECT (EXTRACT(EPOCH FROM max(synced_at)) * 1000)::float8 AS ms FROM desk.tickets`);
  return rows[0]?.ms == null ? null : Number(rows[0].ms);
}
