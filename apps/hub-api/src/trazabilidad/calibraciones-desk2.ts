/**
 * Lectura de las FECHAS DE CALIBRACIÓN de los tickets de la base de Desk 2.0
 * (lote 9c). Sólo dos SELECT, por la conexión de sólo lectura de db-desk2.ts.
 * TODA la lectura del campo está aquí: nadie más nombra el campo de Zoho.
 *
 * Opción B (Alfonso, 11/10/2026): se lee SIN tocar Desk 2.0. El campo de Zoho
 * «Fecha de Calibración» no es columna allí, así que se busca (1) por su
 * nombre interno en el ticket tal como lo dio Zoho, `raw->'cf'` (no cambia si
 * alguien renombra la etiqueta) y, si no está, (2) por su etiqueta en
 * `custom_fields`. Ojo: «Fecha Cal. Sensores Ext.» es OTRO campo, no se lee.
 *
 * Tabla y columnas, comprobadas contra el código de Desk 2.0 (repositorio
 * aparte, Desk2: = C:\dev\Desk_2_R1.023, HEAD 7afba67; sólo se leyó):
 *
 *   desk.tickets                 Desk2:packages/zoho-sync/src/db/schema.sql:20-43
 *     number, status             schema.sql:22-23
 *     tipo_servicio, serial      schema.sql:28 (promovidas de «Tipo de Servicio» y «Serial»: rows.ts:87 y :91)
 *     custom_fields              schema.sql:40 (jsonb NOT NULL, etiqueta → valor)
 *     managed_by_app             schema.sql:41
 *     raw                        schema.sql:42 (el ticket entero de Zoho: mappers.ts:53)
 *     equipo_id                  schema.sql:206
 *
 * Formato de la fecha: TEXTO en los dos sitios, tal como lo manda Zoho
 * («AAAA-MM-DD»). `raw` es la respuesta de Zoho sin tocar, y `custom_fields`
 * es su `customFields` menos las etiquetas promovidas a columna
 * (mappers.ts:43-44 y :55-60; «Fecha de Calibración» no está entre ellas,
 * rows.ts:85-…), sin convertir. Las fechas que Desk 2.0 sí promueve las corta
 * con `String(v).slice(0, 10)` (mappers.ts:30-37): aquí se hace lo mismo
 * (`leerFechaCampo`), y lo que no sea una fecha llega con `fecha: null`.
 *
 * ⚠️ `custom_fields` y `raw` se reescriben enteros en cada sincronización de
 * Desk 2.0 (repo.ts:86-92), y un ticket `managed_by_app` ya no recibe lo que
 * cambie en Zoho (repo.ts:71). `raw->'cf'` sólo lo traen los tickets que Desk
 * 2.0 ha releído al detalle: por eso se cuenta cuántos lo traen.
 *
 * MEJORA FUTURA (opción A, aplazada): el día que Desk 2.0 promueva el campo a
 * una columna `fecha_calibracion`, basta una línea: `POR_NOMBRE` pasa a ser `t.fecha_calibracion::text`.
 *
 * Tolerante a fallos como el maestro (maestro-desk2.ts) y, como él, SIN
 * compartir estado con la fuente de la agenda: no entra en `estadoFuente()` ni
 * mueve su cortacircuitos. En respaldo no hay fechas: la réplica de zoho-hub
 * no trae campos personalizados.
 */

import { leerFechaCampo, type TicketCalibracion } from './calibraciones.js';
import { clasificarFallo, type DbLectura, type MotivoRespaldo } from './fuente.js';

/** El campo de Zoho: su nombre interno (en `raw->'cf'`) y su etiqueta (en `custom_fields`). */
export const CAMPO_INTERNO = 'cf_fecha_de_calibracion';
export const ETIQUETA_CAMPO = 'Fecha de Calibración';

export const MENSAJE_SIN_CALIBRACIONES: Record<MotivoRespaldo, string> = {
  sin_variable: 'La conexión con Desk 2.0 no está configurada (falta DESK2_DB_URL): sin ella no se pueden traer las calibraciones.',
  error_conexion: 'No se pudo conectar con la base de Desk 2.0.',
  timeout: 'La base de Desk 2.0 tardó demasiado en responder.',
  error_consulta: 'La base de Desk 2.0 rechazó la consulta de las calibraciones (permisos o esquema).',
};

/** Lo que dio Desk 2.0 en UNA lectura: los tickets con el campo y los recuentos de salud, o por qué no. Nunca el error crudo. */
export type LecturaCalibraciones = { disponible: true; tickets: TicketCalibracion[]; total: number; conCf: number } | { disponible: false; motivo: MotivoRespaldo };
export type LectorCalibraciones = () => Promise<LecturaCalibraciones>;

const POR_NOMBRE = `NULLIF(btrim(t.raw->'cf'->>$1), '')`;
const POR_ETIQUETA = `NULLIF(btrim(t.custom_fields->>$2), '')`;

/** Los tickets que traen el campo (por cualquiera de los dos caminos), y cuántos tickets hay y cuántos traen `raw.cf`. */
export async function leerCalibracionesDesk2(db: DbLectura): Promise<Extract<LecturaCalibraciones, { disponible: true }>> {
  const { rows } = await db.query(
    `SELECT t.number, t.serial, t.equipo_id, t.tipo_servicio, t.status, t.managed_by_app, ${POR_NOMBRE} AS por_nombre, ${POR_ETIQUETA} AS por_etiqueta
       FROM desk.tickets t
      WHERE ${POR_NOMBRE} IS NOT NULL OR ${POR_ETIQUETA} IS NOT NULL
      ORDER BY t.number`,
    [CAMPO_INTERNO, ETIQUETA_CAMPO],
  );
  const salud = await db.query(`SELECT count(*) AS total, count(*) FILTER (WHERE jsonb_typeof(t.raw->'cf') = 'object') AS con_cf FROM desk.tickets t`);
  const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  const tickets = rows.map((r): TicketCalibracion => {
    const nombre = texto(r.por_nombre)?.trim() || null;
    return { numero: Number(r.number), fecha: leerFechaCampo(nombre ?? r.por_etiqueta), campo: nombre ? 'nombre_interno' : 'etiqueta', equipoId: texto(r.equipo_id), serial: texto(r.serial), tipoServicio: texto(r.tipo_servicio), estado: texto(r.status), gestionadoPorApp: r.managed_by_app === true };
  });
  return { disponible: true, tickets, total: Number(salud.rows[0]?.total ?? 0), conCf: Number(salud.rows[0]?.con_cf ?? 0) };
}

/** El lector sobre la conexión de Desk 2.0 (null si no está configurada). No lanza: un intento por llamada y, si falla, el motivo. Al registro sólo van el motivo y el código. */
export function crearLectorCalibraciones(desk2: () => DbLectura | null): LectorCalibraciones {
  return async () => {
    try {
      const db = desk2();
      return db ? await leerCalibracionesDesk2(db) : { disponible: false, motivo: 'sin_variable' };
    } catch (e) {
      const motivo = clasificarFallo(e);
      const code = (e as { code?: unknown } | null)?.code;
      console.warn(`calibraciones: la base de Desk 2.0 no respondió (${motivo}, código ${typeof code === 'string' ? code : 'desconocido'})`);
      return { disponible: false, motivo };
    }
  };
}
