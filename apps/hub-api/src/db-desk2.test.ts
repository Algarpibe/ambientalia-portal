import { describe, it, expect, afterEach, vi } from 'vitest';
import { DESK2_MAX_CONEXIONES, DESK2_TIMEOUT_CONEXION_MS, DESK2_TIMEOUT_CONSULTA_MS, cerrarDesk2Pool, crearPoolDesk2, enmascararUrl, getDesk2Pool } from './db-desk2.js';

// La conexión opcional a la base de Desk 2.0. Aquí no se abre ninguna conexión:
// crear el pool no conecta (es perezoso). Que de verdad sea de sólo lectura y
// que el tope de tiempo corte una consulta lo prueba fuente.db.test.ts contra
// Postgres. La URL es inventada: el dominio .invalid no resuelve nunca.

const URL_FICTICIA = 'postgres://lector_ficticio:clave-ficticia@desk-ficticio.invalid:5432/desk';

afterEach(async () => {
  await cerrarDesk2Pool();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('DESK2_DB_URL es opcional', () => {
  it('sin la variable no hay pool y no se lanza nada', () => {
    vi.stubEnv('DESK2_DB_URL', undefined as unknown as string);
    expect(getDesk2Pool()).toBeNull();
  });

  it('vacía o en blanco vale lo mismo que no ponerla', () => {
    vi.stubEnv('DESK2_DB_URL', '   ');
    expect(getDesk2Pool()).toBeNull();
  });

  it('con la variable crea UN pool (el mismo en cada llamada) y lo anuncia sin escribir la URL', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('DESK2_DB_URL', URL_FICTICIA);
    const pool = getDesk2Pool();
    expect(pool).not.toBeNull();
    expect(getDesk2Pool()).toBe(pool);
    const escrito = log.mock.calls.flat().join(' ');
    expect(escrito).toContain('DESK2_DB_URL');
    for (const secreto of ['lector_ficticio', 'clave-ficticia', 'desk-ficticio.invalid']) expect(escrito).not.toContain(secreto);
  });
});

describe('el pool', () => {
  it('es pequeño, con topes de tiempo cortos y de sólo lectura desde que conecta', async () => {
    const pool = crearPoolDesk2(URL_FICTICIA);
    try {
      const o = (pool as unknown as { options: Record<string, unknown> }).options;
      expect(o.max).toBe(DESK2_MAX_CONEXIONES);
      expect(DESK2_MAX_CONEXIONES).toBeLessThanOrEqual(3);
      expect(o.connectionTimeoutMillis).toBe(DESK2_TIMEOUT_CONEXION_MS);
      expect(DESK2_TIMEOUT_CONEXION_MS).toBeLessThanOrEqual(5_000);
      expect(o.statement_timeout).toBe(DESK2_TIMEOUT_CONSULTA_MS);
      expect(DESK2_TIMEOUT_CONSULTA_MS).toBeLessThanOrEqual(10_000);
      expect(String(o.options)).toContain('default_transaction_read_only=on');
      // Perezoso: crearlo no ha abierto ninguna conexión.
      expect(pool.totalCount).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

describe('enmascararUrl', () => {
  it('deja ver sólo el protocolo y la base', () => {
    const m = enmascararUrl(URL_FICTICIA);
    expect(m).toBe('postgres://***:***@***/desk');
  });

  it('no deja pasar nada de un texto que no es una URL', () => {
    expect(enmascararUrl('clave-ficticia sin forma de url')).toBe('***');
    expect(enmascararUrl('')).toBe('***');
  });
});
