import type { Pool } from '@algarpibe/zoho-sync';
import type { DestinatarioCorreo, EmailEstado } from './types.js';
import type { WoSalesConfig } from './config.js';
import type { SalesOrderFiltro } from './source.js';

/** El id de la app en portal.user_apps (mismo que en el frontend y en requireApp). */
const APP_ID = 'WO-sales';

/**
 * Destinatarios del correo automático = usuarios del portal APROBADOS (status 'active')
 * que tengan la app WO-sales asignada. Una sola fuente de verdad: quien puede usar la
 * app es quien recibe el archivo. Se gestiona desde "Gestión de Usuarios → Asignar apps",
 * no hay lista aparte.
 */
export async function listarActivos(db: Pool): Promise<DestinatarioCorreo[]> {
  const { rows } = await db.query(
    `SELECT u.email, u.full_name AS nombre
       FROM portal.users u
       JOIN portal.user_apps ua ON ua.user_id = u.id
      WHERE ua.app_id = $1 AND u.status = 'active'
      ORDER BY u.email`,
    [APP_ID]
  );
  return rows as DestinatarioCorreo[];
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
