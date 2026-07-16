import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedUsersFromEnv } from './users/seed-from-env.js';

let pool: Pool | null = null;

/** Returns the shared read-only hub pool, creating it on first use. */
export function getHubPool(): Pool {
  if (!pool) {
    const url = process.env.HUB_DB_URL;
    if (!url) throw new Error('HUB_DB_URL is not set');
    pool = createPoolFromUrl(url);
    // Without a listener, an idle-client 'error' (backend restart, network
    // blip) is an unhandled EventEmitter error and crashes the process.
    pool.on('error', (err: Error) => console.error('hub pool error', err));
  }
  return pool;
}

// Migraciones aplicadas en orden al arranque. Son idempotentes (IF NOT EXISTS),
// así que re-ejecutarlas en cada boot es seguro.
const MIGRATIONS = ['001_create_users.sql', '002_add_avatar.sql', '003_add_preferences.sql', '004_wo_sales_email.sql'];

function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'users', 'migrations');
}

/**
 * Inicialización de BD en el arranque (Requirements 6.3, 6.5):
 *  - Si HUB_DB_URL no está definida → termina el proceso (< 5 s).
 *  - Si la BD no es alcanzable → termina el proceso con mensaje de error.
 *  - Ejecuta las migraciones pendientes y el seed desde AUTH_USERS.
 *
 * Debe llamarse (y esperarse) antes de `app.listen`.
 */
export async function initDb(): Promise<void> {
  if (!process.env.HUB_DB_URL) {
    console.error('FATAL: HUB_DB_URL no está definida. No es posible arrancar hub-api.');
    process.exit(1);
  }

  let db: Pool;
  try {
    db = getHubPool();
    await db.query('SELECT 1');
  } catch (err) {
    console.error('FATAL: no se pudo conectar a la base de datos del hub.', err);
    process.exit(1);
  }

  const dir = migrationsDir();
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.query(sql);
    console.log(`migration applied: ${file}`);
  }

  await seedUsersFromEnv(db);
}
