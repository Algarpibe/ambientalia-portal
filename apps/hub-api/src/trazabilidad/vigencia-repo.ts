/**
 * La vigencia guardada por marca (lote 11, migración 063) y, desde el lote 12
 * (064), la frecuencia de preventivo de cada cliente: SÓLO LEE. La regla (qué
 * vale sin fila, GRIMM EDM 180 fijo, «según contrato») es `vigenciaDeGrupo`
 * (marcas.ts); quien cambia la de una marca, con motivo y firma, es
 * marcas-repo.ts (`cambiarVigencia`), y la de un cliente, contratos-repo.ts.
 * La leen quienes calculan el estado de calibración: el inventario (repo.ts),
 * la pestaña y la exportación (hoja-repo.ts), el plan de las calibraciones
 * (calibraciones-repo.ts) y la tarjeta de marcas. Sin imports más que tipos.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { CambioVigencia, FrecuenciasContrato, ValorVigencia, VigenciaGuardada, VigenciasGuardadas } from './marcas.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const dias = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
/** Días, null o «según contrato» (`'contrato'`, el `SEGUN_CONTRATO` de marcas.ts: aquí sólo hay tipos). */
const valor = (n: unknown, contrato: unknown): ValorVigencia => (contrato === true ? 'contrato' : dias(n));

/**
 * Lo que necesita la regla, en UNA consulta (así la pestaña y la exportación siguen con sus cinco): lo guardado por marca —clave → días,
 * null (sin vencimiento) o «según contrato»— y por cliente —`claveCliente` → meses, o null (sin contrato)—. Sin fila, vale el código.
 */
export async function leerVigencias(db: Db): Promise<{ vigencias: VigenciasGuardadas; contratos: FrecuenciasContrato }> {
  const { rows } = await db.query(`SELECT 'marca' AS de, clave, dias AS valor, contrato FROM portal.tmc_marcas_vigencia UNION ALL SELECT 'cliente', clave, meses, FALSE FROM portal.tmc_contratos`);
  const filas = rows as Row[];
  return {
    vigencias: new Map(filas.filter((r) => r.de === 'marca').map((r) => [r.clave as string, valor(r.valor, r.contrato)])),
    contratos: new Map(filas.filter((r) => r.de === 'cliente').map((r) => [r.clave as string, dias(r.valor)])),
  };
}

/** Lo guardado con su firma, para la tarjeta «Marcas en seguimiento». */
export async function leerVigenciasConFirma(db: Db): Promise<VigenciaGuardada[]> {
  const { rows } = await db.query(`SELECT clave, marca, dias, contrato, motivo, por, en::text AS en FROM portal.tmc_marcas_vigencia ORDER BY clave`);
  return (rows as Row[]).map((r) => ({ clave: r.clave, marca: r.marca, dias: dias(r.dias), contrato: r.contrato === true, motivo: r.motivo, por: r.por, en: r.en }));
}

/** Los últimos `limite` cambios de vigencia, el más reciente primero. */
export async function leerCambiosVigencia(db: Db, limite: number): Promise<CambioVigencia[]> {
  const { rows } = await db.query(`SELECT id, clave, marca, antes, despues, antes_contrato, despues_contrato, motivo, por, en::text AS en FROM portal.tmc_marcas_vigencia_cambios ORDER BY id DESC LIMIT ${Number(limite)}`);
  return (rows as Row[]).map((r) => ({ id: Number(r.id), clave: r.clave, marca: r.marca, antes: valor(r.antes, r.antes_contrato), despues: valor(r.despues, r.despues_contrato), motivo: r.motivo, por: r.por, en: r.en }));
}
