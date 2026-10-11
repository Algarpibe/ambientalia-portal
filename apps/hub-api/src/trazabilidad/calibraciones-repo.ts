/**
 * SQL de las calibraciones en la base del PORTAL (lote 9c, migración 057):
 * reunir lo guardado y calcular el plan con la regla de calibraciones.ts.
 * Desk 2.0 llega como función: el lector de calibraciones-desk2.ts.
 *
 * Lote 9c-1: SÓLO LEE. El plan dice qué filas nacerían y cuáles se anularían,
 * pero aquí nada las escribe todavía (calibraciones.test.ts vigila que este
 * fichero no tenga ninguna escritura): aplicar el plan, y que el inventario
 * enseñe la fecha de la regla, son del lote 9c-2.
 */

import { createHash } from 'node:crypto';
import type { Pool } from '@algarpibe/zoho-sync';
import { MENSAJE_SIN_CALIBRACIONES, type LectorCalibraciones, type LecturaCalibraciones } from './calibraciones-desk2.js';
import { planCalibraciones, saludLectura, type EquipoInventario, type FilaPartida, type PasadaCalibraciones, type PlanCalibraciones, type RespuestaPlanCalibraciones, type SaludLectura } from './calibraciones.js';
import { claveCliente } from './dominio.js';
import type { Celda } from './fst022.js';
import type { EstadoMaestro } from './maestro.js';
import { leerCalibraciones } from './repo.js';

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
  const inventario = await db.query(`SELECT clave, serial, activo, desk_id, ultima_calibracion::text AS ultima_calibracion FROM portal.tmc_equipos`);
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
