/**
 * SQL de las calibraciones en la base del PORTAL (lote 9c, migración 057):
 * reunir lo guardado, calcular el plan con la regla de calibraciones.ts,
 * aplicarlo y dejar su pasada. Desk 2.0 llega como función: el lector de
 * calibraciones-desk2.ts.
 *
 * Una pasada escribe, y sólo si Desk 2.0 contestó en esa misma operación:
 * filas nuevas en tmc_calibraciones (las de Desk y, una vez por equipo, la de
 * partida) y la anulación de las que ya no valen. Una fecha NUNCA se edita.
 * No toca el inventario (tmc_equipos y su `ultima_calibracion` se quedan como
 * están: el inventario enseña la fecha de la regla, `listarEquipos`), ni el
 * seguimiento, ni los contactos, ni la congelación, ni las filas manuales
 * (calibraciones.test.ts vigila la lista de escrituras). Se trae a mano, tras
 * ver el plan, o desde el lote 10 en la pasada nocturna, que lo llama igual
 * (con la huella del plan que evaluó) sólo si el plan es limpio
 * (pasadas-nocturnas-repo.ts). Este fichero no sabe nada de ella.
 */

import { createHash } from 'node:crypto';
import type { Pool } from '@algarpibe/zoho-sync';
import { MENSAJE_SIN_CALIBRACIONES, type LectorCalibraciones, type LecturaCalibraciones } from './calibraciones-desk2.js';
import { calibracionQueCuenta, planCalibraciones, saludLectura, type EquipoInventario, type FilaPartida, type PasadaCalibraciones, type PlanCalibraciones, type RespuestaHistorialCalibraciones, type RespuestaPlanCalibraciones, type SaludLectura } from './calibraciones.js';
import { claveCliente } from './dominio.js';
import type { Celda } from './fst022.js';
import { EN_INVENTARIO } from './inventario.js';
import type { EstadoMaestro } from './maestro.js';
import { leerCalibraciones, withTransaction } from './repo.js';
import { TzError, type Actor } from './types.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Leida = Extract<LecturaCalibraciones, { disponible: true }>;

/** Cuántas líneas del detalle se enseñan para revisar, como mucho (el recuento va entero; lo que hay que mirar primero, delante). */
export const DETALLE_MAX = 300;

const estadoDe = (l: LecturaCalibraciones): EstadoMaestro => (l.disponible ? { disponible: true, motivo: null, mensaje: null } : { disponible: false, motivo: l.motivo, mensaje: MENSAJE_SIN_CALIBRACIONES[l.motivo] });

/** La huella de un plan: lo que escribiría. Dos planes con la misma huella hacen lo mismo. */
export const huellaDePlan = (plan: PlanCalibraciones): string => createHash('sha256').update(JSON.stringify([plan.altas, plan.anular])).digest('hex');

const COLS_PASADA = `id, huella, recuentos, por, en::text AS en`;
const toPasada = (r: Row): PasadaCalibraciones => ({ id: Number(r.id), huella: r.huella, recuentos: r.recuentos, por: r.por, en: r.en });
const ultimaPasada = async (db: Db): Promise<PasadaCalibraciones | null> => {
  const { rows } = await db.query(`SELECT ${COLS_PASADA} FROM portal.tmc_calibraciones_pasadas ORDER BY id DESC LIMIT 1`);
  return rows[0] ? toPasada(rows[0]) : null;
};

const valor = (c: Celda | undefined): unknown => (c !== null && typeof c === 'object' ? c.v : c);

/** La «Última Calibración» de cada fila de equipo de la congelación vigente: la columna que su cabecera titula así (en la V3, la quinta). */
async function leerPartida(db: Db): Promise<FilaPartida[]> {
  const { rows } = await db.query(
    `SELECT g.cabeceras, f.celdas, f.serial_norm, f.clave_equipo
       FROM portal.tmc_fst022_congelaciones g JOIN portal.tmc_fst022_congelada f ON f.congelacion_id = g.id
      WHERE g.vigente AND f.es_equipo
      ORDER BY f.fila`,
  );
  const columna = (((rows[0] as Row | undefined)?.cabeceras as Celda[][] | undefined)?.at(-1) ?? []).map((t) => claveCliente(valor(t))).indexOf('ultima calibracion');
  return (rows as Row[]).map((r) => {
    const fecha = valor((r.celdas as Celda[])[columna]);
    return { clave: r.clave_equipo, serialNorm: r.serial_norm, fecha: typeof fecha === 'string' ? fecha : null };
  });
}

/** El plan de ahora: lo leído en Desk 2.0 contra las calibraciones guardadas, el inventario entero (activo o no) y la hoja congelada. */
async function calcular(db: Db, lectura: Leida, hoy: string, ultima: PasadaCalibraciones | null): Promise<{ plan: PlanCalibraciones; huella: string; salud: SaludLectura }> {
  const filas = await leerCalibraciones(db);
  // Sólo los equipos del inventario (058 y, desde el lote 9f, los de una marca incluida, 061): las otras marcas, aunque ya estén
  // enlazadas con Desk 2.0, siguen con sus calibraciones por serial y sin clave, y la pestaña «Trazabilidad F-ST-022» las atribuye a su
  // fila (hoja.ts). Al incluir una marca, sus partidas y sus sueltas ya se escribieron (marcas-repo.ts): aquí no nace ninguna otra.
  const inventario = await db.query(`SELECT clave, serial, activo, desk_id, ultima_calibracion::text AS ultima_calibracion FROM portal.tmc_equipos WHERE ${EN_INVENTARIO}`);
  const equipos = (inventario.rows as Row[]).map((r): EquipoInventario => ({ clave: r.clave, serial: r.serial, activo: r.activo, deskId: r.desk_id, ultimaCalibracion: r.ultima_calibracion }));
  const plan = planCalibraciones({ hoy, tickets: lectura.tickets, total: lectura.total, conCf: lectura.conCf, filas, equipos, partida: await leerPartida(db) });
  const antes = Math.max(filas.filter((f) => f.origen === 'desk' && f.estado !== 'anulada').length, ultima?.recuentos.conCampo ?? 0);
  return { plan, huella: huellaDePlan(plan), salud: saludLectura(plan.recuentos.conCampo, antes) };
}

/**
 * El plan en recuentos, el estado de la lectura, su salud y la última pasada.
 * Sin Desk 2.0 no hay plan (no es un error: se dice por qué). `conDetalle`
 * añade el detalle para revisar —con seriales—, acotado: sólo para quien puede traer.
 */
export async function leerPlanCalibraciones(db: Db, leer: LectorCalibraciones, hoy: string, conDetalle: boolean): Promise<RespuestaPlanCalibraciones> {
  const [lectura, ultima] = await Promise.all([leer(), ultimaPasada(db)]);
  if (!lectura.disponible) return { lectura: estadoDe(lectura), plan: null, salud: null, ultima };
  const { plan, huella, salud } = await calcular(db, lectura, hoy, ultima);
  return { lectura: estadoDe(lectura), plan: { huella, recuentos: plan.recuentos }, salud, ultima, ...(conDetalle ? { detalle: plan.detalle.slice(0, DETALLE_MAX), detalleTotal: plan.detalle.length } : {}) };
}

/**
 * Aplica el plan de ahora, todo o nada, y deja su pasada. Sin Desk 2.0 no
 * escribe (409), ni si el plan de ahora no es el que se revisó (`huellaVista`;
 * 409), ni si la lectura es sospechosa (ningún ticket trae ya el campo; 409).
 * Con su bloqueo, dos a la vez van una detrás de otra y la segunda calcula su
 * plan con lo que dejó la primera. Aplicarlo dos veces no cambia nada la segunda.
 */
export async function sincronizarCalibraciones(db: Pool, leer: LectorCalibraciones, huellaVista: string | null, actor: Actor, hoy: string): Promise<PasadaCalibraciones> {
  const lectura = await leer();
  if (!lectura.disponible) throw new TzError('calibraciones_no_disponibles', 409, `${MENSAJE_SIN_CALIBRACIONES[lectura.motivo]} No se ha traído nada.`);
  return withTransaction(db, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('portal.tmc_calibraciones_pasadas'))`);
    const { plan, huella, salud } = await calcular(c, lectura, hoy, await ultimaPasada(c));
    if (huellaVista !== null && huellaVista !== huella) {
      throw new TzError('plan_cambiado', 409, 'El plan ha cambiado desde que lo revisaste (cambió algo en Desk 2.0 o alguien las trajo antes). No se ha aplicado nada: revisa el plan de ahora y vuelve a confirmar.');
    }
    if (salud.bloquea) throw new TzError('lectura_sospechosa', 409, salud.mensaje ?? '');
    const { rows } = await c.query(
      `INSERT INTO portal.tmc_calibraciones_pasadas (huella, recuentos, detalle, por_id, por)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)
       RETURNING ${COLS_PASADA}`,
      [huella, JSON.stringify(plan.recuentos), JSON.stringify(plan.detalle), actor.userId, actor.email],
    );
    const pasada = toPasada(rows[0]);
    const firma = [pasada.id, actor.userId, actor.email];
    // Primero se anula: el índice único no admite dos filas sin anular del mismo ticket.
    if (plan.anular.length > 0) {
      await c.query(
        `UPDATE portal.tmc_calibraciones c
            SET estado = 'anulada', anulada_pasada_id = $2::bigint, anulada_por_id = $3::uuid, anulada_por = $4, anulada_en = NOW(), anulada_motivo = x.motivo
           FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, motivo text)
          WHERE c.id = x.id AND c.estado <> 'anulada'`,
        [JSON.stringify(plan.anular), ...firma],
      );
    }
    if (plan.altas.length > 0) {
      await c.query(
        `INSERT INTO portal.tmc_calibraciones (clave, serial, serial_norm, desk_equipo_id, fecha, origen, ticket, estado, motivo, pasada_id, por_id, por)
         SELECT x.clave, x.serial, x."serialNorm", x."deskEquipoId", x.fecha, x.origen, x.ticket, x.estado, x.motivo, $2::bigint, $3::uuid, $4
           FROM jsonb_to_recordset($1::jsonb) AS x(clave text, serial text, "serialNorm" text, "deskEquipoId" text, fecha date, origen text, ticket integer, estado text, motivo text)`,
        [JSON.stringify(plan.altas), ...firma],
      );
    }
    return pasada;
  });
}

/** El historial de calibraciones de un equipo, la más reciente primero, y cuál es la que cuenta hoy. */
export async function historialCalibraciones(db: Db, clave: string, hoy: string): Promise<RespuestaHistorialCalibraciones> {
  const filas = await leerCalibraciones(db, clave);
  const cuenta = calibracionQueCuenta(filas, hoy);
  return { clave, ultima: cuenta?.fecha ?? null, calibraciones: filas.map((f) => ({ ...f, cuenta: f === cuenta })).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id) };
}
