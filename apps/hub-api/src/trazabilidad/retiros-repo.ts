/**
 * Retirar y reincorporar a mano (lote 9d-2b, migración 059). Nada se borra:
 * retirar es MARCAR, con motivo y firma, y se puede deshacer.
 *
 *  - Un equipo: `activo = FALSE` con su marca de «retirado a mano» (quién,
 *    cuándo, por qué). Sale de Resumen, Equipos, Calendario y Avisos como
 *    cualquier inactivo (esos lectores no han cambiado) y conserva su
 *    seguimiento y sus calibraciones. La sincronización con el maestro RESPETA
 *    la marca: no lo reactiva aunque Desk 2.0 lo tenga activo (maestro.ts).
 *    Reincorporar quita la marca y lo deja activo: vuelve a seguir al maestro.
 *  - Una fila de la hoja sin equipo (sólo en la hoja, o con el serial
 *    repetido): se apunta el retiro; la hoja congelada no se toca. Está
 *    retirada si su último apunte es un retiro.
 *
 * Cada cambio deja su apunte en tmc_retiros (quién, cuándo, motivo, valor
 * anterior y nuevo): es la auditoría, y no se cambia ni se borra. De un equipo
 * sólo se toca `activo` y la marca: cliente, marca, modelo y serial son del
 * maestro, y `en_seguimiento` no lo cambia nadie (retiros.test.ts y
 * seguimiento.test.ts lo vigilan). No avisa a nadie.
 */

import type { Pool } from '@algarpibe/zoho-sync';
import { leerHoja } from './hoja-repo.js';
import type { ApunteRetiro, RespuestaRetiro } from './hoja.js';
import { withTransaction } from './repo.js';
import { TzError, type Actor } from './types.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
interface Objeto { clave: string | null; fila: number | null }

/** Los apuntes de un equipo o de una fila de la congelación vigente, el más reciente primero. */
export async function listarRetiros(db: Db, o: Objeto): Promise<ApunteRetiro[]> {
  const { rows } = await db.query(
    `SELECT r.id, r.accion, r.motivo, r.antes, r.despues, r.por, r.en::text AS en
       FROM portal.tmc_retiros r
      WHERE r.clave = $1 OR (r.fila = $2 AND r.congelacion_id = (SELECT g.id FROM portal.tmc_fst022_congelaciones g WHERE g.vigente))
      ORDER BY r.id DESC`,
    [o.clave, o.fila],
  );
  return (rows as ApunteRetiro[]).map((r) => ({ ...r, id: Number(r.id) }));
}

const apuntar = (c: Db, o: Objeto & { congelacion: number | null }, retirar: boolean, motivo: string, actor: Actor) =>
  c.query(
    `INSERT INTO portal.tmc_retiros (clave, congelacion_id, fila, accion, motivo, antes, despues, por_id, por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [o.clave, o.congelacion, o.fila, retirar ? 'retirar' : 'reincorporar', motivo, retirar ? 'activo' : 'retirado', retirar ? 'retirado' : 'activo', actor.userId, actor.email],
  );

/**
 * Retira (`retirar`) o reincorpora un equipo, de cualquier ámbito, y lo apunta: las dos cosas o ninguna. 404 si no existe; 409 si
 * ya está retirado, si está inactivo sin que nadie lo retirara (lo está en Desk 2.0: no hay nada que marcar) o, al reincorporar,
 * si no está retirado.
 */
export async function retirarEquipo(db: Pool, clave: string, retirar: boolean, motivo: string, actor: Actor): Promise<RespuestaRetiro> {
  await withTransaction(db, async (c) => {
    const { rows } = await c.query(`SELECT e.activo, e.retirado_en IS NOT NULL AS retirado FROM portal.tmc_equipos e WHERE e.clave = $1 FOR UPDATE`, [clave]);
    const e = rows[0] as { activo: boolean; retirado: boolean } | undefined;
    if (!e) throw new TzError('not_found', 404, 'Ese equipo no existe en el portal.');
    if (!retirar && !e.retirado) throw new TzError('no_retirado', 409, 'Ese equipo no está retirado: no hay nada que reincorporar.');
    if (retirar && e.retirado) throw new TzError('ya_retirado', 409, 'Ese equipo ya está retirado.');
    if (retirar && !e.activo) throw new TzError('equipo_inactivo', 409, 'Ese equipo ya está inactivo (lo está en Desk 2.0 o lo dejó así una importación antigua): no entra en Resumen ni en Avisos y no hace falta retirarlo.');
    await c.query(
      `UPDATE portal.tmc_equipos e
          SET activo = NOT $2::boolean, actualizado_en = NOW(), retirado_en = CASE WHEN $2 THEN NOW() END,
              retirado_por_id = CASE WHEN $2 THEN $3::uuid END, retirado_por = CASE WHEN $2 THEN $4::text END, retirado_motivo = CASE WHEN $2 THEN $5::text END
        WHERE e.clave = $1`,
      [clave, retirar, actor.userId, actor.email, motivo],
    );
    await apuntar(c, { clave, congelacion: null, fila: null }, retirar, motivo, actor);
  });
  return { retirado: retirar, retiros: await listarRetiros(db, { clave, fila: null }) };
}

/**
 * Retira o recupera una fila de la congelación vigente que NO es de ningún equipo del portal. 404 si la fila no existe; 409 si es
 * de un equipo (se retira el equipo), si ya está retirada o, al recuperarla, si no lo está. La hoja congelada no se toca.
 */
export async function retirarFila(db: Pool, fila: number, retirar: boolean, motivo: string, actor: Actor, hoy: string): Promise<RespuestaRetiro> {
  const hoja = await leerHoja(db, hoy);
  const f = hoja.filas.find((x) => x.fila === fila);
  if (!f || !hoja.congelacion) throw new TzError('not_found', 404, 'Esa fila no es de un equipo de la hoja F-ST-022 congelada.');
  if (f.clave !== null) throw new TzError('fila_con_equipo', 409, 'Esa fila es de un equipo del portal: lo que se retira (o se reincorpora) es el equipo.');
  const congelacion = hoja.congelacion.id;
  await withTransaction(db, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('portal.tmc_retiros'))`);
    const { rows } = await c.query(`SELECT r.accion FROM portal.tmc_retiros r WHERE r.congelacion_id = $1 AND r.fila = $2 ORDER BY r.id DESC LIMIT 1`, [congelacion, fila]);
    const retirada = rows[0]?.accion === 'retirar';
    if (retirar && retirada) throw new TzError('ya_retirada', 409, 'Esa fila ya está retirada.');
    if (!retirar && !retirada) throw new TzError('no_retirada', 409, 'Esa fila no está retirada.');
    await apuntar(c, { clave: null, congelacion, fila }, retirar, motivo, actor);
  });
  return { retirado: retirar, retiros: await listarRetiros(db, { clave: null, fila }) };
}
