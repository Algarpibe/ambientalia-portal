/**
 * SQL del maestro de equipos en la base del PORTAL (lote 9b, migración 056):
 * leer el inventario, calcular el plan con la regla de maestro.ts, aplicarlo
 * y dejar su auditoría. El maestro (Desk 2.0) llega como función: el lector
 * de maestro-desk2.ts.
 *
 * Una sincronización escribe, y sólo si el maestro contestó en esa misma
 * operación: en los equipos que casan, el enlace (desk_id, origen,
 * maestro_en) y cliente, modelo, serial y activo; y las altas, sin fecha de
 * calibración. NO toca la fecha de calibración de un equipo que ya existe
 * (lote 9c), lo que sólo está en el portal, los ambiguos, el seguimiento, los
 * contactos ni la congelación, y no borra ni desactiva nada por no estar en
 * el maestro (maestro.test.ts vigila la lista de escrituras). Se aplica a
 * mano, tras ver el plan: no hay sincronización automática.
 */

import { createHash } from 'node:crypto';
import type { Pool } from '@algarpibe/zoho-sync';
import { claveCliente } from './dominio.js';
import type { Celda } from './fst022.js';
import { MENSAJE_SIN_MAESTRO, type LectorMaestro, type LecturaMaestro } from './maestro-desk2.js';
import { cruceFst022, planMaestro, type EquipoMaestro, type EquipoPortal, type EstadoMaestro, type PlanMaestro, type RespuestaCruceFst022, type RespuestaPlanMaestro, type SincronizacionMaestro } from './maestro.js';
import { withTransaction } from './repo.js';
import { TzError, type Actor } from './types.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Cuántos cambios del plan se enseñan para revisar, como mucho (el recuento va entero). */
export const DETALLE_MAX = 300;

const estadoDe = (l: LecturaMaestro): EstadoMaestro => (l.disponible ? { disponible: true, motivo: null, mensaje: null } : { disponible: false, motivo: l.motivo, mensaje: MENSAJE_SIN_MAESTRO[l.motivo] });

/** La huella de un plan: lo que escribiría y lo que cambia. Dos planes con la misma huella hacen lo mismo. */
export const huellaDePlan = (plan: PlanMaestro): string => createHash('sha256').update(JSON.stringify([plan.enlaces, plan.altas, plan.cambios])).digest('hex');

/** El plan de ahora: el maestro ya leído contra el inventario entero del portal (activos o no) y los contactos puestos a mano. */
async function calcular(db: Db, equipos: readonly EquipoMaestro[]): Promise<{ plan: PlanMaestro; huella: string }> {
  const [inventario, contactos] = await Promise.all([
    db.query(`SELECT clave, serial, cliente, modelo, activo, desk_id FROM portal.tmc_equipos`),
    db.query(`SELECT clave FROM portal.tmc_contactos`),
  ]);
  const portal = (inventario.rows as Row[]).map((r): EquipoPortal => ({ clave: r.clave, serial: r.serial, cliente: r.cliente, modelo: r.modelo, activo: r.activo, deskId: r.desk_id }));
  const plan = planMaestro(equipos, portal, (contactos.rows as Row[]).map((r) => claveCliente(r.clave)));
  return { plan, huella: huellaDePlan(plan) };
}

const COLS_SINCRONIZACION = `id, huella, recuentos, por, en::text AS en`;
const toSincronizacion = (r: Row): SincronizacionMaestro => ({ id: Number(r.id), huella: r.huella, recuentos: r.recuentos, por: r.por, en: r.en });

/**
 * El plan en recuentos, el estado del maestro y la última sincronización. Sin
 * maestro no hay plan (no es un error: se dice por qué). `conDetalle` añade los
 * cambios uno a uno —con clientes y seriales—, acotados: sólo para quien puede aplicarlos.
 */
export async function leerPlanMaestro(db: Db, leer: LectorMaestro, conDetalle: boolean): Promise<RespuestaPlanMaestro> {
  const [lectura, { rows }] = await Promise.all([leer(), db.query(`SELECT ${COLS_SINCRONIZACION} FROM portal.tmc_maestro_sincronizaciones ORDER BY id DESC LIMIT 1`)]);
  const ultima = rows[0] ? toSincronizacion(rows[0]) : null;
  if (!lectura.disponible) return { maestro: estadoDe(lectura), plan: null, ultima };
  const { plan, huella } = await calcular(db, lectura.equipos);
  return { maestro: estadoDe(lectura), plan: { huella, recuentos: plan.recuentos }, ultima, ...(conDetalle ? { detalle: plan.cambios.slice(0, DETALLE_MAX), detalleTotal: plan.cambios.length } : {}) };
}

/**
 * Aplica el plan de ahora, todo o nada, y deja su fila de auditoría. Sin
 * maestro no escribe (409), ni si el plan de ahora no es el que se revisó
 * (`huellaVista`; 409). Con su bloqueo, dos a la vez van una detrás de otra y
 * la segunda calcula su plan con lo que dejó la primera. Aplicarlo dos veces
 * no cambia nada la segunda (sólo `maestro_en`: cuándo se confirmó).
 */
export async function sincronizarMaestro(db: Pool, leer: LectorMaestro, huellaVista: string | null, actor: Actor): Promise<SincronizacionMaestro> {
  const lectura = await leer();
  if (!lectura.disponible) throw new TzError('maestro_no_disponible', 409, `${MENSAJE_SIN_MAESTRO[lectura.motivo]} No se ha sincronizado nada.`);
  return withTransaction(db, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('portal.tmc_maestro_sincronizaciones'))`);
    const { plan, huella } = await calcular(c, lectura.equipos);
    if (huellaVista !== null && huellaVista !== huella) {
      throw new TzError('plan_cambiado', 409, 'El plan ha cambiado desde que lo revisaste (cambió algo en Desk 2.0 o alguien sincronizó antes). No se ha aplicado nada: revisa el plan de ahora y vuelve a confirmar.');
    }
    if (plan.enlaces.length > 0) {
      await c.query(
        `UPDATE portal.tmc_equipos e
            SET actualizado_en = CASE WHEN (e.serial, e.cliente, e.modelo, e.activo, e.desk_id) IS DISTINCT FROM (x.serial, x.cliente, x.modelo, x.activo, x."deskId") THEN NOW() ELSE e.actualizado_en END,
                desk_id = x."deskId", origen = 'desk', maestro_en = NOW(), serial = x.serial, cliente = x.cliente, modelo = x.modelo, activo = x.activo
           FROM jsonb_to_recordset($1::jsonb) AS x(clave text, "deskId" text, serial text, cliente text, modelo text, activo boolean)
          WHERE e.clave = x.clave`,
        [JSON.stringify(plan.enlaces)],
      );
    }
    if (plan.altas.length > 0) {
      await c.query(
        `INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, activo, desk_id, origen, maestro_en)
         SELECT x.clave, x.serial, x.cliente, x.marca, x.modelo, TRUE, x."deskId", 'desk', NOW()
           FROM jsonb_to_recordset($1::jsonb) AS x(clave text, "deskId" text, serial text, cliente text, marca text, modelo text)`,
        [JSON.stringify(plan.altas)],
      );
    }
    const { rows } = await c.query(
      `INSERT INTO portal.tmc_maestro_sincronizaciones (huella, recuentos, cambios, por_id, por)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)
       RETURNING ${COLS_SINCRONIZACION}`,
      [huella, JSON.stringify(plan.recuentos), JSON.stringify(plan.cambios), actor.userId, actor.email],
    );
    return toSincronizacion(rows[0]);
  });
}

const valor = (c: Celda | undefined): unknown => (c !== null && typeof c === 'object' ? c.v : c);

/** Cruce informativo, de TODAS las marcas, entre la congelación vigente de la F-ST-022 y el maestro: recuentos por marca. No escribe. La marca de cada fila congelada sale de la columna que la cabecera titula «Marca». */
export async function leerCruceFst022(db: Db, leer: LectorMaestro): Promise<RespuestaCruceFst022> {
  const [lectura, { rows: vigentes }] = await Promise.all([leer(), db.query(`SELECT g.id, g.archivo, g.cabeceras FROM portal.tmc_fst022_congelaciones g WHERE g.vigente`)]);
  const v = vigentes[0] as Row | undefined;
  const congelacion = v ? { id: Number(v.id), archivo: v.archivo as string } : null;
  if (!lectura.disponible || !v) return { maestro: estadoDe(lectura), congelacion, marcas: [] };
  const titulos = ((v.cabeceras as Celda[][]).at(-1) ?? []).map((t) => claveCliente(valor(t)));
  const { rows } = await db.query(`SELECT celdas, serial_norm FROM portal.tmc_fst022_congelada WHERE congelacion_id = $1 AND es_equipo ORDER BY fila`, [v.id]);
  const congeladas = (rows as Row[]).map((r) => ({ marca: valor((r.celdas as Celda[])[titulos.indexOf('marca')]), serial: r.serial_norm }));
  return { maestro: estadoDe(lectura), congelacion, marcas: cruceFst022(congeladas, lectura.equipos) };
}
