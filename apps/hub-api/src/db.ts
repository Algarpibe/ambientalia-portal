import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';

let pool: Pool | null = null;

/** Returns the shared read-only hub pool, creating it on first use. */
export function getHubPool(): Pool {
  if (!pool) {
    const url = process.env.HUB_DB_URL;
    if (!url) throw new Error('HUB_DB_URL is not set');
    pool = createPoolFromUrl(url);
  }
  return pool;
}
