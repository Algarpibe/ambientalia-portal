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
 *
 * Desde el lote 9d-2a el plan trae dos ámbitos y los dos se aplican en la
 * misma transacción: el de siempre (GRIMM EDM 180, en seguimiento) y las otras
 * marcas, que se dan de alta FUERA de seguimiento (058). Una fila que
 * ya existe se actualiza igual en los dos y NUNCA cambia su `en_seguimiento`
 * ni su marca. Lee la tabla entera (seguimiento.test.ts).
 *
 * Desde el lote 9d-2b ya no es el único que escribe tmc_equipos: una persona
 * puede retirar un equipo a mano (retiros-repo.ts, migración 059). Esa marca
 * se RESPETA aquí: un retirado a mano no se reactiva aunque el maestro lo
 * tenga activo (lo dice el plan y lo vuelve a mirar el SQL); su cliente, su
 * modelo y su serial sí siguen actualizándose.
 *
 * Desde el lote 9f (061) un alta de una marca INCLUIDA entra sola en el
 * inventario (`EN_INVENTARIO`, inventario.ts: no se le cambia el ámbito); en
 * esta misma transacción `adoptarIncluidas` (marcas-repo.ts) le da su
 * partida y le enlaza sus calibraciones sueltas, para que su fecha sea desde
 * el primer momento la que ya le daba la pestaña. Con todas las marcas
 * apagadas no escribe nada. Y los recuentos de clientes del plan cuentan
 * también los equipos de las marcas incluidas.
 */

import { createHash } from 'node:crypto';
import type { Pool } from '@algarpibe/zoho-sync';
import { claveCliente } from './dominio.js';
import type { Celda } from './fst022.js';
import { MENSAJE_SIN_MAESTRO, type LectorMaestro, type LecturaMaestro } from './maestro-desk2.js';
import { adoptarIncluidas } from './marcas-repo.js';
import { cruceFst022, planMaestro, type EquipoMaestro, type EquipoPortal, type EstadoMaestro, type FilaHojaCruce, type PlanMaestro, type RespuestaCruceFst022, type RespuestaPlanMaestro, type SincronizacionMaestro } from './maestro.js';
import { withTransaction } from './repo.js';
import { TzError, type Actor } from './types.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Cuántos cambios del plan se enseñan para revisar, como mucho (el recuento va entero). */
export const DETALLE_MAX = 300;

const estadoDe = (l: LecturaMaestro): EstadoMaestro => (l.disponible ? { disponible: true, motivo: null, mensaje: null } : { disponible: false, motivo: l.motivo, mensaje: MENSAJE_SIN_MAESTRO[l.motivo] });

/** La huella de un plan: lo que escribiría y lo que cambia, en los dos ámbitos. Dos planes con la misma huella hacen lo mismo. */
export const huellaDePlan = (plan: PlanMaestro): string => createHash('sha256').update(JSON.stringify([plan.enlaces, plan.altas, plan.cambios, plan.otras.enlaces, plan.otras.altas, plan.otras.cambios])).digest('hex');

const valor = (c: Celda | undefined): unknown => (c !== null && typeof c === 'object' ? c.v : c);

/** Las filas de equipo de la congelación vigente, para cruzarlas: marca y cliente salen de las columnas que la cabecera titula así. Sin congelación, ninguna. */
async function leerHojaCongelada(db: Db): Promise<{ congelacion: { id: number; archivo: string } | null; filas: FilaHojaCruce[] }> {
  const { rows: vigentes } = await db.query(`SELECT g.id, g.archivo, g.cabeceras FROM portal.tmc_fst022_congelaciones g WHERE g.vigente`);
  const v = vigentes[0] as Row | undefined;
  if (!v) return { congelacion: null, filas: [] };
  const titulos = ((v.cabeceras as Celda[][]).at(-1) ?? []).map((t) => claveCliente(valor(t)));
  const { rows } = await db.query(`SELECT celdas, serial_norm, clave_equipo FROM portal.tmc_fst022_congelada WHERE congelacion_id = $1 AND es_equipo ORDER BY fila`, [v.id]);
  const celda = (r: Row, titulo: string): unknown => valor((r.celdas as Celda[])[titulos.indexOf(titulo)]);
  return { congelacion: { id: Number(v.id), archivo: v.archivo }, filas: (rows as Row[]).map((r) => ({ marca: celda(r, 'marca'), serial: r.serial_norm ?? null, cliente: String(celda(r, 'cliente') ?? '').trim(), claveEquipo: r.clave_equipo ?? null })) };
}

/** El plan de ahora: el maestro ya leído contra el inventario entero del portal (activos o no, en seguimiento o no), los contactos puestos a mano y la hoja congelada. */
async function calcular(db: Db, equipos: readonly EquipoMaestro[]): Promise<{ plan: PlanMaestro; huella: string }> {
  // Una detrás de otra: al aplicar, `db` es el cliente de la transacción, y un cliente no lleva dos consultas a la vez.
  const inventario = await db.query(`SELECT clave, serial, cliente, marca, modelo, activo, desk_id, en_seguimiento, retirado_en FROM portal.tmc_equipos`);
  const contactos = await db.query(`SELECT clave FROM portal.tmc_contactos`);
  // Las marcas incluidas (lote 9f, 061): sus equipos están en el inventario y sus clientes cuentan en los recuentos de clientes del plan.
  const incluidas = await db.query(`SELECT clave FROM portal.tmc_marcas WHERE incluida`);
  const hoja = await leerHojaCongelada(db);
  const portal = (inventario.rows as Row[]).map((r): EquipoPortal => ({ clave: r.clave, serial: r.serial, cliente: r.cliente, marca: r.marca, modelo: r.modelo, activo: r.activo, deskId: r.desk_id, enSeguimiento: r.en_seguimiento !== false, retiradoAMano: r.retirado_en != null }));
  const plan = planMaestro(equipos, portal, (contactos.rows as Row[]).map((r) => claveCliente(r.clave)), hoja.filas, new Set((incluidas.rows as Row[]).map((r) => r.clave as string)));
  return { plan, huella: huellaDePlan(plan) };
}

const COLS_SINCRONIZACION = `id, huella, recuentos, por, en::text AS en`;
const toSincronizacion = (r: Row): SincronizacionMaestro => ({ id: Number(r.id), huella: r.huella, recuentos: r.recuentos, por: r.por, en: r.en });

/**
 * El plan en recuentos, el estado del maestro y la última sincronización. Sin
 * maestro no hay plan (no es un error: se dice por qué). `conDetalle` añade los
 * cambios uno a uno y lo que el plan no toca (sólo en el portal y ambiguos) —con clientes y seriales—, acotados: sólo para quien puede aplicarlos.
 */
export async function leerPlanMaestro(db: Db, leer: LectorMaestro, conDetalle: boolean): Promise<RespuestaPlanMaestro> {
  const [lectura, { rows }] = await Promise.all([leer(), db.query(`SELECT ${COLS_SINCRONIZACION} FROM portal.tmc_maestro_sincronizaciones ORDER BY id DESC LIMIT 1`)]);
  const ultima = rows[0] ? toSincronizacion(rows[0]) : null;
  if (!lectura.disponible) return { maestro: estadoDe(lectura), plan: null, ultima };
  const { plan, huella } = await calcular(db, lectura.equipos);
  const tope = <T>(lista: readonly T[]): T[] => lista.slice(0, DETALLE_MAX);
  // El detalle del seguimiento va como siempre; el de las otras marcas, aparte (`otras`), con lo que no se enlaza de la hoja.
  const detalle = { detalle: tope(plan.cambios), detalleTotal: plan.cambios.length, revisar: { soloPortal: tope(plan.soloPortal), ambiguos: tope(plan.ambiguos) }, otras: { detalle: tope(plan.otras.cambios), detalleTotal: plan.otras.cambios.length, soloPortal: tope(plan.otras.soloPortal), ambiguos: tope(plan.otras.ambiguos), hoja: tope(plan.hoja.revisar) } };
  return { maestro: estadoDe(lectura), plan: { huella, recuentos: plan.recuentos, otras: plan.otras.recuentos, hoja: plan.hoja.marcas }, ultima, ...(conDetalle ? detalle : {}) };
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
    // Los dos ámbitos se escriben igual; lo único que los distingue es con qué `en_seguimiento` NACE un alta.
    const enlaces = [...plan.enlaces, ...plan.otras.enlaces];
    const altas = [...plan.altas.map((a) => ({ ...a, enSeguimiento: true })), ...plan.otras.altas.map((a) => ({ ...a, enSeguimiento: false }))];
    if (enlaces.length > 0) {
      // Un equipo retirado a mano (059) no se reactiva: el plan ya lo trae inactivo, y aquí se vuelve a mirar por si alguien lo retiró mientras tanto.
      await c.query(
        `UPDATE portal.tmc_equipos e
            SET actualizado_en = CASE WHEN (e.serial, e.cliente, e.modelo, e.activo, e.desk_id) IS DISTINCT FROM (x.serial, x.cliente, x.modelo, x.activo, x."deskId") THEN NOW() ELSE e.actualizado_en END,
                desk_id = x."deskId", origen = 'desk', maestro_en = NOW(), serial = x.serial, cliente = x.cliente, modelo = x.modelo, activo = x.activo AND e.retirado_en IS NULL
           FROM jsonb_to_recordset($1::jsonb) AS x(clave text, "deskId" text, serial text, cliente text, modelo text, activo boolean)
          WHERE e.clave = x.clave`,
        [JSON.stringify(enlaces)],
      );
    }
    if (altas.length > 0) {
      await c.query(
        `INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, activo, desk_id, origen, maestro_en, en_seguimiento)
         SELECT x.clave, x.serial, x.cliente, x.marca, x.modelo, TRUE, x."deskId", 'desk', NOW(), x."enSeguimiento"
           FROM jsonb_to_recordset($1::jsonb) AS x(clave text, "deskId" text, serial text, cliente text, marca text, modelo text, "enSeguimiento" boolean)`,
        [JSON.stringify(altas)],
      );
    }
    // Lote 9f: un alta de una marca incluida (061) entra sola en el inventario; aquí recibe su partida y sus sueltas, como al encender la marca.
    await adoptarIncluidas(c, actor);
    const { rows } = await c.query(
      `INSERT INTO portal.tmc_maestro_sincronizaciones (huella, recuentos, cambios, por_id, por)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)
       RETURNING ${COLS_SINCRONIZACION}`,
      // La auditoría lleva los dos ámbitos: los recuentos de las otras marcas en `otras` y sus cambios marcados con `ambito: 'otras'`.
      [huella, JSON.stringify({ ...plan.recuentos, otras: plan.otras.recuentos }), JSON.stringify([...plan.cambios, ...plan.otras.cambios]), actor.userId, actor.email],
    );
    return toSincronizacion(rows[0]);
  });
}

/** Cruce informativo, de TODAS las marcas, entre la congelación vigente de la F-ST-022 y el maestro: recuentos por marca. No escribe. */
export async function leerCruceFst022(db: Db, leer: LectorMaestro): Promise<RespuestaCruceFst022> {
  const [lectura, { congelacion, filas }] = await Promise.all([leer(), leerHojaCongelada(db)]);
  return { maestro: estadoDe(lectura), congelacion, marcas: lectura.disponible && congelacion ? cruceFst022(filas, lectura.equipos) : [] };
}
