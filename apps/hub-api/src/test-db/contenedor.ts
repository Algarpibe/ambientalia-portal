import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { GlobalSetupContext } from 'vitest/node';
import { createPoolFromUrl } from '@algarpibe/zoho-sync';
import { aplicarMigraciones } from '../db.js';

let contenedor: StartedPostgreSqlContainer | null = null;

/**
 * Un Postgres de verdad para toda la suite, migrado con el MISMO array que usa
 * el arranque de produccion.
 *
 * La imagen se fija a mano, y a la que corre PRODUCCION: el 2026-08-18 un
 * `SELECT version()` contra EasyPanel devolvio PostgreSQL 17.10 sobre Debian.
 * Se usa la variante Debian y no la `-alpine` porque alpine va con musl, y la
 * ordenacion de texto depende de la libc: un harness que dice ser fiel no
 * deberia diferir tambien en eso. Un `latest` derivaria solo.
 *
 * Si algun dia EasyPanel sube de version mayor, esta linea se queda mintiendo
 * en silencio — los tests seguirian verdes contra un motor que ya no es el de
 * produccion. Es el precio de fijarla, y es mejor que el de no fijarla.
 */
export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  // El timeout va AQUI y no en el `hookTimeout` de vitest: ese solo envuelve los
  // before*/after* de los tests, y NO la funcion `setup` de un globalSetup
  // (comprobado en el codigo de vitest 2.1.9). Sin esto, un registry lento o una
  // VPN caida dejan `test:db` colgado para siempre en vez de fallar.
  contenedor = await new PostgreSqlContainer('postgres:17').withStartupTimeout(180_000).start();
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
