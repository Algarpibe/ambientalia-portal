import type { Pool } from '@algarpibe/zoho-sync';
import type { EmailEstado, Recipient } from './types.js';
import type { WoSalesConfig } from './config.js';
import type { SalesOrderFiltro } from './source.js';

interface FilaRecipient {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
}
const mapRecipient = (r: FilaRecipient): Recipient => ({
  id: r.id,
  email: r.email,
  nombre: r.nombre,
  activo: r.activo,
});

export async function listarDestinatarios(db: Pool): Promise<Recipient[]> {
  const { rows } = await db.query(
    'SELECT id, email, nombre, activo FROM portal.wo_sales_recipients ORDER BY created_at'
  );
  return (rows as FilaRecipient[]).map(mapRecipient);
}

export async function listarActivos(db: Pool): Promise<Recipient[]> {
  const { rows } = await db.query(
    'SELECT id, email, nombre, activo FROM portal.wo_sales_recipients WHERE activo = TRUE ORDER BY created_at'
  );
  return (rows as FilaRecipient[]).map(mapRecipient);
}

/** Devuelve null si ese email ya existe (email es UNIQUE; se normaliza a minúsculas). */
export async function crearDestinatario(db: Pool, email: string, nombre: string): Promise<Recipient | null> {
  const { rows } = await db.query(
    `INSERT INTO portal.wo_sales_recipients (email, nombre) VALUES (lower($1), $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, nombre, activo`,
    [email, nombre]
  );
  return rows.length ? mapRecipient(rows[0] as FilaRecipient) : null;
}

export async function setActivo(db: Pool, id: string, activo: boolean): Promise<Recipient | null> {
  const { rows } = await db.query(
    'UPDATE portal.wo_sales_recipients SET activo = $2 WHERE id = $1 RETURNING id, email, nombre, activo',
    [id, activo]
  );
  return rows.length ? mapRecipient(rows[0] as FilaRecipient) : null;
}

export async function borrarDestinatario(db: Pool, id: string): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM portal.wo_sales_recipients WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function leerEstado(db: Pool): Promise<EmailEstado> {
  const { rows } = await db.query(
    'SELECT ultimo_hash, ultimo_envio_at::text AS ultimo_envio_at FROM portal.wo_sales_email_estado WHERE id = 1'
  );
  if (!rows.length) return { ultimoHash: null, ultimoEnvioAt: null };
  return { ultimoHash: rows[0].ultimo_hash, ultimoEnvioAt: rows[0].ultimo_envio_at };
}

export async function guardarEstado(db: Pool, hash: string): Promise<void> {
  // Upsert de la fila singleton (id=1): avanza el hash y sella la fecha.
  await db.query(
    `INSERT INTO portal.wo_sales_email_estado (id, ultimo_hash, ultimo_envio_at)
     VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET ultimo_hash = EXCLUDED.ultimo_hash, ultimo_envio_at = EXCLUDED.ultimo_envio_at`,
    [hash]
  );
}

/**
 * Números de OV vivas del rango modificadas después de `desde` (mejor esfuerzo, para el
 * cuerpo del correo). Si `desde` es null (primer envío), devuelve todas las del rango.
 */
export async function cambiadasDesde(
  db: Pool,
  config: WoSalesConfig,
  filtro: SalesOrderFiltro,
  desde: string | null
): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT salesorder_number FROM books.sales_orders
      WHERE status = ANY($1::text[]) AND date >= $2::date AND date <= $3::date
        AND ($4::timestamptz IS NULL OR zoho_last_modified > $4::timestamptz)
      ORDER BY salesorder_number`,
    [config.estadosVivos, filtro.desde, filtro.hasta, desde]
  );
  return (rows as { salesorder_number: string }[]).map((r) => r.salesorder_number);
}
