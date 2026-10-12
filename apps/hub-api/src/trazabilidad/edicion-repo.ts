/**
 * Editar a mano (lote 9d-2b): lo que una PERSONA cambia en las calibraciones
 * guardadas, con su motivo y su firma. Vale para un equipo en seguimiento,
 * para uno enlazado fuera de seguimiento y para una fila que sólo está en la
 * hoja congelada (a ésa se le guarda por su serial, sin clave).
 *
 *  - Registrar una calibración manual: una fila nueva, `vigente`. Si corrige
 *    un ticket, guarda su número y la fecha que ese ticket tiene ahora: lo tapa
 *    mientras esa fecha no cambie en Zoho (la regla es la de calibraciones.ts).
 *  - Anular una fila (manual, de ticket o de partida): deja de contar. La firma
 *    una persona y por eso la pasada de Desk 2.0 no la resucita. No se desanula.
 *  - Anular la partida de una fila de la hoja: esa fecha no es una fila
 *    guardada (sale de la congelación, que es inmutable), así que se guarda ya
 *    anulada y la pestaña deja de tomarla de la hoja.
 *
 * Una fecha NUNCA se edita y nada se borra (edicion.test.ts vigila qué se
 * escribe aquí). No toca el inventario, el seguimiento, los contactos ni la
 * congelación, y no avisa a nadie: la «última calibración» —y con ella el
 * estado del equipo y su sitio en Resumen, Calendario y Avisos— la recalcula
 * la regla de siempre en la lectura siguiente.
 */

import type { Pool } from '@algarpibe/zoho-sync';
import { serialNorm } from './dominio.js';
import { leerHoja } from './hoja-repo.js';
import type { FilaHoja, RespuestaEdicion } from './hoja.js';
import { withTransaction } from './repo.js';
import { TzError, type Actor, type CalibracionManual } from './types.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
interface Destino { clave: string | null; serial: string }

/** El bloqueo de la pasada de calibraciones: una corrección a mano y una pasada van una detrás de otra. */
const BLOQUEO = `SELECT pg_advisory_xact_lock(hashtext('portal.tmc_calibraciones_pasadas'))`;

const todas = async (db: Db, hoy: string): Promise<FilaHoja[]> => {
  const hoja = await leerHoja(db, hoy);
  return [...hoja.filas, ...hoja.fueraDeHoja];
};

/** La fila de la pestaña —de la hoja o fuera de ella— de ese equipo o de esa fila de la hoja: de ahí salen su situación y sus calibraciones. */
async function filaDe(db: Db, hoy: string, d: { clave: string | null; fila: number | null }): Promise<FilaHoja> {
  const f = (await todas(db, hoy)).find((x) => (d.clave !== null ? x.clave === d.clave : x.fila === d.fila));
  if (!f) throw new TzError('not_found', 404, d.clave !== null ? 'Ese equipo no existe en el portal.' : 'Esa fila no es de un equipo de la hoja F-ST-022 congelada.');
  return f;
}

/** A quién se le guarda: al equipo, por su clave; o, si la fila sólo está en la hoja, a su serial tal como lo normalizó la congelación (así se lo atribuye la pestaña). */
async function destinoDe(c: Db, f: FilaHoja): Promise<Destino> {
  if (f.clave !== null) return { clave: f.clave, serial: f.serial };
  if (f.avisos.includes('serial_repetido') || f.avisos.includes('sin_serial')) {
    throw new TzError('serial_ambiguo', 409, 'Esa fila no tiene serial, o lo repite otra fila de la hoja: no se sabría de cuál de las dos es la calibración. Retira antes la fila que sobra o corrige el equipo en Desk 2.0.');
  }
  const { rows } = await c.query(`SELECT f.serial_norm FROM portal.tmc_fst022_congelada f JOIN portal.tmc_fst022_congelaciones g ON g.id = f.congelacion_id WHERE g.vigente AND f.es_equipo AND f.fila = $1`, [f.fila]);
  return { clave: null, serial: rows[0].serial_norm };
}

/** La única alta: una manual vigente o, con `anulada` (su motivo), la partida de una fila de la hoja que nace ya anulada. Devuelve su id. */
async function insertar(c: Db, d: Destino, x: { fecha: string; origen: 'manual' | 'fst022'; corrigeTicket: number | null; corrigeFecha: string | null; motivo: string; anulada: string | null }, actor: Actor): Promise<number> {
  const { rows } = await c.query(
    `INSERT INTO portal.tmc_calibraciones (clave, serial, serial_norm, fecha, origen, corrige_ticket, corrige_fecha, motivo, por_id, por, estado, anulada_por_id, anulada_por, anulada_en, anulada_motivo)
     SELECT $1::text, $2::text, $3::text, $4::date, $5::text, $6::integer, $7::date, $8::text, $9::uuid, $10::text, CASE WHEN a THEN 'anulada' ELSE 'vigente' END,
            CASE WHEN a THEN $9::uuid END, CASE WHEN a THEN $10::text END, CASE WHEN a THEN NOW() END, $11::text
       FROM (SELECT $11::text IS NOT NULL AS a) x
     RETURNING id`,
    [d.clave, d.serial, serialNorm(d.serial), x.fecha, x.origen, x.corrigeTicket, x.corrigeFecha, x.motivo, actor.userId, actor.email, x.anulada],
  );
  return Number(rows[0].id);
}

/** El historial de la fila o del equipo al que pertenece esa calibración, ya recalculado, con la fecha que cuenta hoy. */
async function despues(db: Db, hoy: string, id: number): Promise<RespuestaEdicion> {
  const f = (await todas(db, hoy)).find((x) => x.calibraciones.some((c) => c.id === id));
  return { id, clave: f?.clave ?? null, fila: f?.fila ?? null, ultima: f?.ultimaCalibracion ?? null, estado: f?.estado ?? null, calibraciones: f?.calibraciones ?? [] };
}

/** Registra una calibración manual. 404 si el equipo o la fila no existen; 409 si el ticket que dice corregir no es de ese equipo o ya tiene una corrección vigente. */
export async function registrarManual(db: Pool, m: CalibracionManual, actor: Actor, hoy: string): Promise<RespuestaEdicion> {
  const f = await filaDe(db, hoy, m);
  const id = await withTransaction(db, async (c) => {
    await c.query(BLOQUEO);
    const d = await destinoDe(c, f);
    let corrigeFecha: string | null = null;
    if (m.corrigeTicket !== null) {
      // El ticket tiene que ser uno de los de ESTE historial, con su calibración sin anular: se guarda la fecha que tiene ahora.
      const { rows } = await c.query(
        `SELECT c.id, c.fecha::text AS fecha,
                EXISTS (SELECT 1 FROM portal.tmc_calibraciones m WHERE m.origen = 'manual' AND m.estado = 'vigente' AND m.corrige_ticket = c.ticket AND m.corrige_fecha = c.fecha) AS corregido
           FROM portal.tmc_calibraciones c
          WHERE c.origen = 'desk' AND c.ticket = $1 AND c.estado <> 'anulada'`,
        [m.corrigeTicket],
      );
      const t = rows[0] as { id: string; fecha: string; corregido: boolean } | undefined;
      if (!t || !f.calibraciones.some((x) => x.id === Number(t.id))) throw new TzError('ticket_sin_calibracion', 409, `El ticket n.º ${m.corrigeTicket} no tiene una calibración guardada, sin anular, en el historial de este equipo: no hay fecha que corregir.`, 'corrigeTicket');
      if (t.corregido) throw new TzError('ticket_ya_corregido', 409, `El ticket n.º ${m.corrigeTicket} ya tiene una corrección vigente: anúlala antes de registrar otra.`, 'corrigeTicket');
      corrigeFecha = t.fecha;
    }
    return insertar(c, d, { fecha: m.fecha, origen: 'manual', corrigeTicket: m.corrigeTicket, corrigeFecha, motivo: m.motivo, anulada: null }, actor);
  });
  return despues(db, hoy, id);
}

/** Anula una fila guardada (manual, de ticket o de partida), con motivo y firma. 404 si no existe; 409 si ya lo estaba. */
export async function anularCalibracion(db: Pool, id: number, motivo: string, actor: Actor, hoy: string): Promise<RespuestaEdicion> {
  const { rowCount } = await db.query(
    `UPDATE portal.tmc_calibraciones SET estado = 'anulada', anulada_por_id = $2::uuid, anulada_por = $3, anulada_en = NOW(), anulada_motivo = $4
      WHERE id = $1 AND estado <> 'anulada'`,
    [id, actor.userId, actor.email, motivo],
  );
  if (!rowCount) {
    const { rows } = await db.query(`SELECT 1 FROM portal.tmc_calibraciones c WHERE c.id = $1`, [id]);
    throw rows.length > 0 ? new TzError('ya_anulada', 409, 'Esa calibración ya estaba anulada.') : new TzError('not_found', 404, 'Esa calibración no existe.');
  }
  return despues(db, hoy, id);
}

/** Anula la fecha de partida que una fila de la hoja toma de la congelación: la guarda, ya anulada. 404 si la fila no existe; 409 si esa fecha ya es una fila guardada (se anula por su id) o la hoja no la trae. */
export async function anularPartida(db: Pool, fila: number, motivo: string, actor: Actor, hoy: string): Promise<RespuestaEdicion> {
  const f = await filaDe(db, hoy, { clave: null, fila });
  const partida = f.calibraciones.find((c) => c.id === -fila);
  if (!partida) throw new TzError('partida_guardada', 409, 'Esa fila no toma su fecha de partida de la hoja: o la hoja no trae fecha, o ya es una calibración guardada, que se anula desde su historial.');
  const id = await withTransaction(db, async (c) => {
    await c.query(BLOQUEO);
    return insertar(c, await destinoDe(c, f), { fecha: partida.fecha, origen: 'fst022', corrigeTicket: null, corrigeFecha: null, motivo: `F-ST-022 congelada (fila ${fila}).`, anulada: motivo }, actor);
  });
  return despues(db, hoy, id);
}
