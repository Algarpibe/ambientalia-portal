import type { Pool } from '@algarpibe/zoho-sync';
import type { DestinatarioCorreo, EmailEstado } from './types.js';
import type { WoSalesConfig } from './config.js';
import type { SalesOrderFiltro } from './source.js';

/** El id de la app en portal.user_apps (mismo que en el frontend y en requireApp). */
const APP_ID = 'WO-sales';

/**
 * Destinatarios PENDIENTES para un hash dado: usuarios del portal APROBADOS (status
 * 'active') con la app WO-sales asignada que aún NO tienen registrado ese hash como
 * recibido. Cubre dos casos con una sola regla:
 *   - cambió el contenido (hash nuevo) → todos quedan pendientes → se envía a todos;
 *   - se añadió un usuario → no tiene fila en wo_sales_email_sent (hash NULL) → solo él
 *     queda pendiente → recibe el archivo actual sin esperar un cambio ni reenviar a los
 *     demás (`IS DISTINCT FROM` trata NULL como "distinto", así que el usuario nuevo entra).
 * Quien puede usar la app es quien recibe el archivo: una sola fuente de verdad, que se
 * gestiona desde "Gestión de Usuarios → Asignar apps".
 */
export async function recipientesPendientes(db: Pool, hash: string): Promise<DestinatarioCorreo[]> {
  const { rows } = await db.query(
    `SELECT u.email, u.full_name AS nombre
       FROM portal.users u
       JOIN portal.user_apps ua ON ua.user_id = u.id
       LEFT JOIN portal.wo_sales_email_sent s ON s.email = u.email
      WHERE ua.app_id = $1 AND u.status = 'active'
        AND s.hash IS DISTINCT FROM $2
      ORDER BY u.email`,
    [APP_ID, hash]
  );
  return rows as DestinatarioCorreo[];
}

/** Registra ese hash como recibido por cada email. Idempotente (upsert por email). */
export async function marcarEnviados(db: Pool, hash: string, emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db.query(
    `INSERT INTO portal.wo_sales_email_sent (email, hash, sent_at)
     SELECT email, $2, now() FROM unnest($1::text[]) AS t(email)
     ON CONFLICT (email) DO UPDATE SET hash = EXCLUDED.hash, sent_at = EXCLUDED.sent_at`,
    [emails, hash]
  );
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
