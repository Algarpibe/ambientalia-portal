import { Pool } from '@algarpibe/zoho-sync';

/**
 * Conexión OPCIONAL y de sólo lectura a la base `desk` de Desk 2.0 (servicio
 * desk-db): la fuente principal de la agenda del taller (D4 en
 * docs/trazabilidad-agenda-taller.md). Es la segunda conexión de hub-api y no
 * debe poder tumbarlo: quien la usa es trazabilidad/fuente.ts, que ante
 * cualquier fallo lee la réplica de siempre.
 *
 * Mismo patrón que SENTRY_DSN (sentry.ts): sin `DESK2_DB_URL` la función
 * queda apagada. Aquí no se comprueba nada en el arranque ni se
 * termina el proceso (al contrario que con HUB_DB_URL en db.ts): el pool es
 * perezoso y sólo conecta cuando alguien consulta.
 *
 * ⚠️ La URL lleva usuario, contraseña y host: no se escribe NUNCA en un
 * registro, en un error ni en una respuesta. Para nombrarla, `enmascararUrl`.
 * Tampoco se registra el error crudo de `pg`, que puede arrastrar el host.
 */

/** Pocas conexiones: son lecturas cortas y la base es de otra aplicación. */
export const DESK2_MAX_CONEXIONES = 2;
/** Tope para abrir conexión. Pasado esto la llamada se da por fallida y se lee la réplica. */
export const DESK2_TIMEOUT_CONEXION_MS = 3_000;
/** Tope de cada consulta (`statement_timeout`): lo corta el propio Postgres. */
export const DESK2_TIMEOUT_CONSULTA_MS = 5_000;

/** La URL sin nada que sirva para conectar: sólo el protocolo y el nombre de la base. */
export function enmascararUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return '***';
    return `${u.protocol}//***:***@***${u.pathname}`;
  } catch {
    return '***';
  }
}

/**
 * Un pool hacia Desk 2.0. Sólo lectura por partida doble: el rol
 * `portal_agenda_reader` ya trae `default_transaction_read_only = on` y sólo
 * `SELECT`, y además cada conexión lo fija al conectar (`options`), por si un
 * día la URL apunta a un rol que no lo traiga.
 *
 * Exportada para las pruebas de Postgres; el servidor usa `getDesk2Pool`.
 */
export function crearPoolDesk2(url: string, topes: { consultaMs?: number; conexionMs?: number } = {}): Pool {
  const pool = new Pool({
    connectionString: url,
    max: DESK2_MAX_CONEXIONES,
    connectionTimeoutMillis: topes.conexionMs ?? DESK2_TIMEOUT_CONEXION_MS,
    idleTimeoutMillis: 30_000,
    statement_timeout: topes.consultaMs ?? DESK2_TIMEOUT_CONSULTA_MS,
    options: '-c default_transaction_read_only=on',
    application_name: 'portal-agenda',
  });
  // Sin listener, el 'error' de un cliente inactivo tumba el proceso (ver
  // db.ts). Sólo el código: el mensaje puede llevar el host.
  pool.on('error', (err: Error) => console.error('desk2 pool error', (err as { code?: unknown }).code ?? 'sin código'));
  return pool;
}

let pool: Pool | null = null;

/** El pool compartido, creado en el primer uso; `null` si no hay `DESK2_DB_URL` (función apagada). */
export function getDesk2Pool(): Pool | null {
  if (pool) return pool;
  const url = process.env.DESK2_DB_URL?.trim();
  if (!url) return null;
  pool = crearPoolDesk2(url);
  console.log(`Fuente principal de la agenda habilitada (DESK2_DB_URL=${enmascararUrl(url)})`);
  return pool;
}

/** Cierra el pool compartido, si lo hay. Para las pruebas. */
export async function cerrarDesk2Pool(): Promise<void> {
  const p = pool;
  pool = null;
  await p?.end();
}
