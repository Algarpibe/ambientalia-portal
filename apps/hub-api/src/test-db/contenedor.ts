import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { GlobalSetupContext } from 'vitest/node';
import { createPoolFromUrl } from '@algarpibe/zoho-sync';
import { aplicarMigraciones } from '../db.js';

let contenedor: StartedPostgreSqlContainer | null = null;

/**
 * Un Postgres de verdad para toda la suite, migrado con el MISMO array que usa
 * el arranque de produccion.
 *
 * La imagen se fija a mano: un `postgres:latest` haria que el harness dijera ser
 * fiel a produccion mientras deriva solo.
 */
export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  // El timeout va AQUI y no en el `hookTimeout` de vitest: ese solo envuelve los
  // before*/after* de los tests, y NO la funcion `setup` de un globalSetup
  // (comprobado en el codigo de vitest 2.1.9). Sin esto, un registry lento o una
  // VPN caida dejan `test:db` colgado para siempre en vez de fallar.
  contenedor = await new PostgreSqlContainer('postgres:16-alpine').withStartupTimeout(180_000).start();
  const url = contenedor.getConnectionUri();

  const db = createPoolFromUrl(url);
  try {
    await aplicarMigraciones(db);
  } finally {
    // Este pool muere aqui: cada fichero de test abre el suyo.
    await db.end();
  }

  provide('urlBd', url);
}

export async function teardown(): Promise<void> {
  await contenedor?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    urlBd: string;
  }
}
