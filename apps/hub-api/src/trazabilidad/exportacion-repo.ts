/**
 * Exportar la F-ST-022 (lote 9e, migración 060): reúne la tabla de la pestaña,
 * genera el libro y APUNTA la exportación. Lo único que escribe es ese apunte
 * (portal.tmc_exportaciones): quién, cuándo, a qué día, cuántas filas, de qué
 * congelación y la huella del fichero, para saber qué copia circula.
 *
 * La tabla sale de la MISMA lectura que la pestaña (`leerHoja`): aquí no hay
 * una segunda regla ni otro SQL de la hoja. Sólo genera un fichero de salida:
 * no acepta ninguno, no envía nada y no toca la hoja congelada ni el inventario.
 * El apunte no lleva clientes ni seriales, y nada de la tabla va a un error.
 */
import { createHash } from 'node:crypto';
import type { Pool } from '@algarpibe/zoho-sync';
import { libroFst022, type Exportacion, type LibroFst022, type RespuestaExportaciones } from './exportacion.js';
import { leerHoja } from './hoja-repo.js';
import type { Actor } from './types.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * El libro de la hoja a `hoy` (día en Colombia), ya apuntado. `ahora` es el instante de la exportación: va en el libro y en el apunte.
 * Si el apunte falla no hay fichero: no sale ninguna copia sin registrar.
 */
export async function exportarHoja(db: Db, hoy: string, actor: Actor, ahora: Date): Promise<LibroFst022> {
  const tabla = await leerHoja(db, hoy);
  const libro = libroFst022({ tabla, exporta: { por: actor.email, en: ahora.toISOString() } });
  await db.query(
    `INSERT INTO portal.tmc_exportaciones (congelacion_id, hoy, filas, retirados, archivo, sha256, por_id, por, en)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
    [tabla.congelacion?.id ?? null, hoy, libro.filas, libro.retirados, libro.nombre, createHash('sha256').update(libro.cuerpo).digest('hex'), actor.userId, actor.email, ahora.toISOString()],
  );
  return libro;
}

/** La última exportación y cuántas van. Sólo la firma y recuentos. */
export async function leerExportaciones(db: Db): Promise<RespuestaExportaciones> {
  const { rows } = await db.query(
    `SELECT x.id, x.por, x.en::text AS en, x.hoy::text AS hoy, x.filas, x.retirados, x.congelacion_id, x.archivo, x.sha256, count(*) OVER () AS total
       FROM portal.tmc_exportaciones x
      ORDER BY x.id DESC
      LIMIT 1`,
  );
  const r = rows[0] as Row | undefined;
  const ultima: Exportacion | null = r ? { id: Number(r.id), por: r.por, en: r.en, hoy: r.hoy, filas: r.filas, retirados: r.retirados, congelacionId: r.congelacion_id === null ? null : Number(r.congelacion_id), archivo: r.archivo, sha256: r.sha256 } : null;
  return { ultima, total: r ? Number(r.total) : 0 };
}
