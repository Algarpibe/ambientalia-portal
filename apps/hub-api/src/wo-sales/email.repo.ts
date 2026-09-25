import type { Pool } from '@algarpibe/zoho-sync';
import type { DestinatarioCorreo, EmailEstado } from './types.js';
import type { WoSalesConfig } from './config.js';
import type { SalesOrderFiltro } from './source.js';
import {
  PREFERENCIA_POR_DEFECTO,
  type EstadoDestinatario,
  type Frecuencia,
  type PreferenciaEnvio,
} from './frecuencia.js';

/** El id de la app en portal.user_apps (mismo que en el frontend y en requireApp). */
const APP_ID = 'WO-sales';

/** Un destinatario posible con todo lo necesario para decidir si se le envía ahora. */
export interface DestinatarioConEstado extends DestinatarioCorreo {
  estado: EstadoDestinatario;
}

interface FilaDestinatario {
  email: string;
  nombre: string;
  hash_recibido: string | null;
  frecuencia: Frecuencia | null;
  hora: number | null;
  dia_semana: number | null;
  ultimo_corte: Date | string | null;
}

/**
 * Todos los destinatarios posibles: usuarios del portal APROBADOS (status 'active') con
 * la app WO-sales asignada (se gestiona en "Gestión de Usuarios → Asignar apps"), con el
 * hash del último archivo que recibieron y su preferencia de frecuencia (sin fila =
 * 'inmediato'). Quién recibe AHORA lo decide `decidirEnvioDestinatario` (frecuencia.ts):
 * un usuario nuevo no tiene hash recibido, así que recibe el archivo actual en su franja.
 */
export async function destinatariosConEstado(db: Pool): Promise<DestinatarioConEstado[]> {
  const { rows } = await db.query(
    `SELECT u.email, u.full_name AS nombre, s.hash AS hash_recibido,
            f.frecuencia, f.hora, f.dia_semana, f.ultimo_corte
       FROM portal.users u
       JOIN portal.user_apps ua ON ua.user_id = u.id
       LEFT JOIN portal.wo_sales_email_sent s ON s.email = u.email
       LEFT JOIN portal.wo_sales_email_frecuencia f ON f.email = u.email
      WHERE ua.app_id = $1 AND u.status = 'active'
      ORDER BY u.email`,
    [APP_ID]
  );
  return (rows as FilaDestinatario[]).map((r) => ({
    email: r.email,
    nombre: r.nombre,
    estado: {
      hashRecibido: r.hash_recibido,
      preferencia: r.frecuencia
        ? { frecuencia: r.frecuencia, hora: r.hora, diaSemana: r.dia_semana }
        : PREFERENCIA_POR_DEFECTO,
      ultimoCorte: r.ultimo_corte ? new Date(r.ultimo_corte) : null,
    },
  }));
}

/** Sella franjas como procesadas (una por email). Solo toca filas existentes: quien no
 *  tiene fila es 'inmediato' y no usa franjas. */
export async function marcarCortes(db: Pool, cortes: { email: string; corte: Date }[]): Promise<void> {
  if (cortes.length === 0) return;
  await db.query(
    `UPDATE portal.wo_sales_email_frecuencia f
        SET ultimo_corte = c.corte
       FROM unnest($1::text[], $2::timestamptz[]) AS c(email, corte)
      WHERE f.email = c.email`,
    [cortes.map((c) => c.email), cortes.map((c) => c.corte.toISOString())]
  );
}

/**
 * Guarda la frecuencia de un destinatario (panel de admin). `ultimo_corte` arranca en
 * now(): la nueva programación empieza a contar desde el cambio, sin disparar un envío
 * inmediato por una franja que ya pasó.
 */
export async function guardarFrecuencia(db: Pool, email: string, pref: PreferenciaEnvio): Promise<void> {
  await db.query(
    `INSERT INTO portal.wo_sales_email_frecuencia (email, frecuencia, hora, dia_semana, ultimo_corte, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (email) DO UPDATE
       SET frecuencia = EXCLUDED.frecuencia, hora = EXCLUDED.hora, dia_semana = EXCLUDED.dia_semana,
           ultimo_corte = now(), updated_at = now()`,
    [email, pref.frecuencia, pref.hora, pref.diaSemana]
  );
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
        AND NOT (salesorder_number = ANY($5::text[]))
      ORDER BY salesorder_number`,
    [config.estadosVivos, filtro.desde, filtro.hasta, desde, config.ordenesExcluidas]
  );
  return (rows as { salesorder_number: string }[]).map((r) => r.salesorder_number);
}
