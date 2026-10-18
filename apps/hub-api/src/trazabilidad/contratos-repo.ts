/**
 * SQL de la frecuencia de preventivo por cliente (lote 12, migración 064).
 *
 * Decisión de Alfonso (18/10/2026): Horiba no tiene plazo fijo de calibración:
 * se calibra con el preventivo, cuya frecuencia depende del CONTRATO de cada
 * cliente. Cada cliente tiene una frecuencia en meses (1..36) o ninguna (sin
 * contrato), con firma, motivo e historial. Sólo la cambia un administrador
 * del portal (`contrato.write`, de ningún rol: lo mira el router antes de
 * validar y de consultar). Una sola frecuencia por cliente.
 *
 * Es el ÚNICO fichero que escribe `tmc_contratos` y su historial
 * (contratos-repo.test.ts lo vigila): inserta o reescribe la fila del cliente
 * —«sin contrato» se guarda como NULL, no se borra: queda quién y por qué— y
 * añade un apunte. No toca equipos, calibraciones ni marcas: el estado de cada
 * equipo «según contrato» lo recalcula la regla (`vigenciaDeGrupo`,
 * marcas.ts) en la lectura siguiente. No envía nada a nadie.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { CambioFrecuencia, FrecuenciaCliente, RespuestaContrato } from './marcas.js';
import { clienteDelInventario, withTransaction } from './repo.js';
import { TzError, type Actor } from './types.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const BLOQUEO = `SELECT pg_advisory_xact_lock(hashtext('portal.tmc_contratos'))`;
const COLS = `clave, cliente, meses, motivo, por, en::text AS en`;
/** Cuántos apuntes del historial de un cliente se devuelven (los más recientes). */
export const CAMBIOS_CONTRATO_MAX = 20;

const meses = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const frecuencia = (r: Row): FrecuenciaCliente => ({ clave: r.clave, cliente: r.cliente, meses: meses(r.meses), motivo: r.motivo, por: r.por, en: r.en });

/** Todas las frecuencias guardadas (también las «sin contrato»): van con GET /equipos para que la app las enseñe. */
export async function listarContratos(db: Db): Promise<FrecuenciaCliente[]> {
  const { rows } = await db.query(`SELECT ${COLS} FROM portal.tmc_contratos ORDER BY cliente, clave`);
  return (rows as Row[]).map(frecuencia);
}

async function guardada(db: Db, clave: string): Promise<FrecuenciaCliente | null> {
  const { rows } = await db.query(`SELECT ${COLS} FROM portal.tmc_contratos WHERE clave = $1`, [clave]);
  return rows[0] ? frecuencia(rows[0] as Row) : null;
}

/** GET /clientes/:clave/frecuencia: la de ese cliente (o null) y su historial, el más reciente primero. Abierta a quien tiene la app. */
export async function leerContrato(db: Db, clave: string): Promise<RespuestaContrato> {
  const { rows } = await db.query(`SELECT id, clave, cliente, antes, despues, motivo, por, en::text AS en FROM portal.tmc_contratos_cambios WHERE clave = $1 ORDER BY id DESC LIMIT ${CAMBIOS_CONTRATO_MAX}`, [clave]);
  const cambios = (rows as Row[]).map((r): CambioFrecuencia => ({ id: Number(r.id), clave: r.clave, cliente: r.cliente, antes: meses(r.antes), despues: meses(r.despues), motivo: r.motivo, por: r.por, en: r.en }));
  return { clave, frecuencia: await guardada(db, clave), cambios };
}

/**
 * Pone la frecuencia de preventivo de un cliente (`meses`, o null = sin contrato), con motivo y firma, todo o nada: su fila y su apunte
 * (antes → después). 404 si el cliente no tiene ningún equipo activo en el inventario ni frecuencia guardada; 409 `misma_frecuencia` si ya
 * tenía ese valor (sin fila = sin contrato). No escribe nada más.
 */
export async function cambiarContrato(db: Pool, clave: string, cambio: { meses: number | null; motivo: string }, actor: Actor): Promise<void> {
  await withTransaction(db, async (c) => {
    await c.query(BLOQUEO);
    const antes = await guardada(c, clave);
    const cliente = ((await clienteDelInventario(c, clave)) ?? antes?.cliente ?? null)?.slice(0, 200);
    if (!cliente) throw new TzError('not_found', 404, 'Ese cliente no tiene ningún equipo activo en el inventario.');
    if ((antes?.meses ?? null) === cambio.meses) throw new TzError('misma_frecuencia', 409, 'Ese cliente ya tiene esa frecuencia de preventivo: no se ha cambiado nada.');
    await c.query(
      `INSERT INTO portal.tmc_contratos (clave, cliente, meses, motivo, por_id, por, en)
       VALUES ($1, $2, $3, $4, $5::uuid, $6, NOW())
       ON CONFLICT (clave) DO UPDATE SET cliente = EXCLUDED.cliente, meses = EXCLUDED.meses, motivo = EXCLUDED.motivo, por_id = EXCLUDED.por_id, por = EXCLUDED.por, en = NOW()`,
      [clave, cliente, cambio.meses, cambio.motivo, actor.userId, actor.email],
    );
    await c.query(
      `INSERT INTO portal.tmc_contratos_cambios (clave, cliente, antes, despues, motivo, por_id, por)
       VALUES ($1, $2, $3, $4, $5, $6::uuid, $7)`,
      [clave, cliente, antes?.meses ?? null, cambio.meses, cambio.motivo, actor.userId, actor.email],
    );
  });
}
