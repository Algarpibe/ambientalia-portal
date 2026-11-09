import type { Pool } from '@algarpibe/zoho-sync';
import { ordenarParaAsignar } from './documento-numero.js';

/**
 * Candado de la numeración (§8.1). Serializa dos generaciones simultáneas del archivo (dos
 * disparadores de n8n, o n8n y una descarga): sin él, las dos leerían el mismo MAX y darían el
 * mismo número a OV distintas. El UNIQUE de la tabla es la red de seguridad. Distinto del
 * candado del correo ('wo-sales:email'): las dos transacciones no se anidan.
 */
const BLOQUEO = `SELECT pg_advisory_xact_lock(hashtext('portal.wo_sales_documento_numero'))`;

interface FilaNumero {
  numero_ov: string;
  documento_numero: number;
}

/**
 * DocumentoNúmero de cada OV (§8.1). Las que ya tienen uno lo conservan; a las que no, se les
 * asigna MAX + 1, + 2… en el orden de `ordenarParaAsignar`. Las filas nunca se borran: una OV
 * que sale del archivo no libera su número. Devuelve el mapa completo (número de OV → número).
 * Todo en una transacción: si algo falla no queda numeración a medias.
 */
export async function asignarDocumentoNumeros(db: Pool, numerosOV: readonly string[]): Promise<Map<string, number>> {
  const unicos = [...new Set(numerosOV)];
  if (unicos.length === 0) return new Map();

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(BLOQUEO);

    const { rows } = await client.query(
      `SELECT numero_ov, documento_numero
         FROM portal.wo_sales_documento_numero
        WHERE numero_ov = ANY($1::text[])`,
      [unicos],
    );
    const numeros = new Map<string, number>(
      (rows as FilaNumero[]).map((r) => [r.numero_ov, Number(r.documento_numero)]),
    );

    const faltan = ordenarParaAsignar(unicos.filter((n) => !numeros.has(n)));
    if (faltan.length > 0) {
      const { rows: maxRows } = await client.query(
        `SELECT COALESCE(MAX(documento_numero), 0)::int AS max FROM portal.wo_sales_documento_numero`,
      );
      const base = Number((maxRows as { max: number }[])[0]?.max ?? 0);
      const nuevos = faltan.map((_, i) => base + 1 + i);
      await client.query(
        `INSERT INTO portal.wo_sales_documento_numero (numero_ov, documento_numero, origen)
         SELECT n, d, 'asignado' FROM unnest($1::text[], $2::int[]) AS u(n, d)`,
        [faltan, nuevos],
      );
      faltan.forEach((n, i) => numeros.set(n, nuevos[i]));
    }

    await client.query('COMMIT');
    return numeros;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
