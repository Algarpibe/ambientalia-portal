/**
 * La vigencia guardada por marca (lote 11, migración 063): SÓLO LEE. La regla
 * (qué vale sin fila, GRIMM EDM 180 fijo) es `vigenciaDeMarca` (marcas.ts);
 * quien la cambia, con motivo y firma, es marcas-repo.ts (`cambiarVigencia`).
 * La leen quienes calculan el estado de calibración: el inventario (repo.ts),
 * la pestaña y la exportación (hoja-repo.ts), el plan de las calibraciones
 * (calibraciones-repo.ts) y la tarjeta de marcas. Sin imports más que tipos.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { CambioVigencia, VigenciaGuardada, VigenciasGuardadas } from './marcas.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const dias = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Lo guardado: clave de la marca → días, o null (sin vencimiento). Las marcas sin fila no vienen (vale `VIGENCIA_POR_DEFECTO`). */
export async function leerVigencias(db: Db): Promise<VigenciasGuardadas> {
  const { rows } = await db.query(`SELECT clave, dias FROM portal.tmc_marcas_vigencia`);
  return new Map((rows as Row[]).map((r) => [r.clave as string, dias(r.dias)]));
}

/** Lo guardado con su firma, para la tarjeta «Marcas en seguimiento». */
export async function leerVigenciasConFirma(db: Db): Promise<VigenciaGuardada[]> {
  const { rows } = await db.query(`SELECT clave, marca, dias, motivo, por, en::text AS en FROM portal.tmc_marcas_vigencia ORDER BY clave`);
  return (rows as Row[]).map((r) => ({ clave: r.clave, marca: r.marca, dias: dias(r.dias), motivo: r.motivo, por: r.por, en: r.en }));
}

/** Los últimos `limite` cambios de vigencia, el más reciente primero. */
export async function leerCambiosVigencia(db: Db, limite: number): Promise<CambioVigencia[]> {
  const { rows } = await db.query(`SELECT id, clave, marca, antes, despues, motivo, por, en::text AS en FROM portal.tmc_marcas_vigencia_cambios ORDER BY id DESC LIMIT ${Number(limite)}`);
  return (rows as Row[]).map((r) => ({ id: Number(r.id), clave: r.clave, marca: r.marca, antes: dias(r.antes), despues: dias(r.despues), motivo: r.motivo, por: r.por, en: r.en }));
}
