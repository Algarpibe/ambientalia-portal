import type { Pool } from '@algarpibe/zoho-sync';
import type { DestinatarioCorreo, EmailEstado } from './types.js';
import type { WoSalesConfig } from './config.js';
import type { SalesOrderFiltro } from './source.js';
import { condicionOvViva } from './hub.source.js';
import {
  PREFERENCIA_POR_DEFECTO,
  type EstadoDestinatario,
  type Frecuencia,
  type PreferenciaEnvio,
} from './frecuencia.js';

/** El id de la app en portal.user_apps (mismo que en el frontend y en requireApp). */
const APP_ID = 'WO-sales';

// El tipo del cliente transaccional se deriva del Pool para no depender de un import
// directo de 'pg' (mismo truco que ausencias/repo.ts y calibraciones/repo.ts).
export type PoolClient = Awaited<ReturnType<Pool['connect']>>;
/** El pool o el cliente de una transacción: las funciones de abajo valen para los dos. */
export type Consultable = Pool | PoolClient;

/**
 * Cuánto queda reservado un destinatario tras servirle un archivo en /pendiente. Tiene
 * que cubrir holgadamente lo que tarda n8n en mandar el correo y llamar a /confirmado
 * (segundos), y ser corto para que un envío que se cayó de verdad se reintente pronto,
 * en el ciclo siguiente. Mismo valor que el outbox de ausencias (019).
 */
const RESERVA = '5 minutes';

/**
 * DATA-339 — ejecuta `fn` en una transacción que tiene en exclusiva el correo de
 * WO-sales hasta el COMMIT.
 *
 * Decidir a quién se envía es leer (wo_sales_email_sent, la frecuencia, las reservas)
 * y luego escribir (cortes y reservas). Si dos /pendiente solapados leen antes de que
 * ninguno escriba, los dos ven a los mismos destinatarios libres y el xlsx sale dos
 * veces. Con este candado el segundo espera en la primera línea y, cuando entra, ya ve
 * las reservas del primero.
 *
 * Candado consultivo y no SELECT ... FOR UPDATE: lo que hay que bloquear incluye filas
 * que todavía NO existen (la reserva de un destinatario nuevo). Es uno solo para todo
 * el correo, que es justo el alcance de la carrera, y se suelta solo con el COMMIT o
 * el ROLLBACK.
 *
 * ⚠️ `fn` tiene que hacer TODAS sus lecturas y escrituras con el `client` que recibe:
 * lo que vaya por el pool sale por otra conexión y queda fuera del candado.
 */
export async function conCandadoDelCorreo<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('wo-sales:email'))`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * De los `emails` dados, los que ya tienen una reserva VIGENTE de este mismo archivo:
 * otra petición se los acaba de llevar y n8n los está enviando. Una reserva de otro
 * hash no cuenta (el archivo cambió y hay que mandar el nuevo), ni una vencida (n8n no
 * confirmó y toca reintentar).
 */
export async function reservasVigentes(db: Consultable, hash: string, emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const { rows } = await db.query(
    `SELECT email FROM portal.wo_sales_email_reserva
      WHERE email = ANY($1::text[]) AND hash = $2 AND reservado_at > now() - $3::interval`,
    [emails, hash, RESERVA]
  );
  return new Set((rows as { email: string }[]).map((r) => r.email));
}

/** Reserva ese archivo para cada email (upsert: una reserva vieja o de otro hash se pisa). */
export async function reservar(db: Consultable, hash: string, emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db.query(
    `INSERT INTO portal.wo_sales_email_reserva (email, hash, reservado_at)
     SELECT email, $2, now() FROM unnest($1::text[]) AS t(email)
     ON CONFLICT (email) DO UPDATE SET hash = EXCLUDED.hash, reservado_at = EXCLUDED.reservado_at`,
    [emails, hash]
  );
}

/** Suelta las reservas de ese archivo para esos emails: ya consta como recibido. */
export async function liberarReservas(db: Consultable, hash: string, emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db.query('DELETE FROM portal.wo_sales_email_reserva WHERE email = ANY($1::text[]) AND hash = $2', [
    emails,
    hash,
  ]);
}

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
export async function destinatariosConEstado(db: Consultable): Promise<DestinatarioConEstado[]> {
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
export async function marcarCortes(db: Consultable, cortes: { email: string; corte: Date }[]): Promise<void> {
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
export async function marcarEnviados(db: Consultable, hash: string, emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db.query(
    `INSERT INTO portal.wo_sales_email_sent (email, hash, sent_at)
     SELECT email, $2, now() FROM unnest($1::text[]) AS t(email)
     ON CONFLICT (email) DO UPDATE SET hash = EXCLUDED.hash, sent_at = EXCLUDED.sent_at`,
    [emails, hash]
  );
}

export async function leerEstado(db: Consultable): Promise<EmailEstado> {
  const { rows } = await db.query(
    'SELECT ultimo_hash, ultimo_envio_at::text AS ultimo_envio_at FROM portal.wo_sales_email_estado WHERE id = 1'
  );
  if (!rows.length) return { ultimoHash: null, ultimoEnvioAt: null };
  return { ultimoHash: rows[0].ultimo_hash, ultimoEnvioAt: rows[0].ultimo_envio_at };
}

export async function guardarEstado(db: Consultable, hash: string): Promise<void> {
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
    `SELECT so.salesorder_number FROM books.sales_orders so
      WHERE ${condicionOvViva(1, 6)} AND so.date >= $2::date AND so.date <= $3::date
        AND ($4::timestamptz IS NULL OR so.zoho_last_modified > $4::timestamptz)
        AND NOT (so.salesorder_number = ANY($5::text[]))
      ORDER BY so.salesorder_number`,
    [config.estadosVivos, filtro.desde, filtro.hasta, desde, config.ordenesExcluidas, config.estadosFacturaSinEnviar]
  );
  return (rows as { salesorder_number: string }[]).map((r) => r.salesorder_number);
}
