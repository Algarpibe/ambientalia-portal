import { describe, it, expect } from 'vitest';
import {
  HUB_ESPERA_CANDADO_MIGRACION_MS,
  HUB_MAX_CONEXIONES,
  HUB_TIMEOUT_CONEXION_MS,
  HUB_TIMEOUT_CONSULTA_MS,
  crearPoolHub,
  crearPoolMigraciones,
  urlMigraciones,
} from './db.js';

// DATA-331 — el pool principal es el de TODO hub-api, login incluido
// (requireAuth relee rol y apps de la BD en cada petición). Sin topes, una
// consulta colgada o un pool agotado dejan esperando para siempre a todas las
// peticiones detrás. Aquí no se conecta: crear el pool es perezoso. Que el tope
// corte de verdad una consulta lo prueba db.timeouts.db.test.ts contra Postgres.

const URL_FICTICIA = 'postgres://lector_ficticio:clave-ficticia@hub-ficticio.invalid:5432/zoho-hub';

const opciones = (p: unknown) => (p as { options: Record<string, unknown> }).options;

describe('el pool principal', () => {
  it('tiene tope de conexiones, de espera por conexión y de duración de cada consulta', async () => {
    const pool = crearPoolHub(URL_FICTICIA);
    try {
      const o = opciones(pool);
      expect(o.max).toBe(HUB_MAX_CONEXIONES);
      expect(o.connectionTimeoutMillis).toBe(HUB_TIMEOUT_CONEXION_MS);
      expect(HUB_TIMEOUT_CONEXION_MS).toBeGreaterThan(0);
      expect(o.statement_timeout).toBe(HUB_TIMEOUT_CONSULTA_MS);
      expect(HUB_TIMEOUT_CONSULTA_MS).toBeGreaterThan(0);
      expect(pool.totalCount).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

describe('el pool de las migraciones', () => {
  it('no corta las consultas por tiempo: una migración lenta no debe impedir el arranque', async () => {
    const pool = crearPoolMigraciones(URL_FICTICIA);
    try {
      expect(opciones(pool).statement_timeout).toBeFalsy();
      expect(opciones(pool).max).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('sí corta la espera por un candado (DATA-340): un ALTER bloqueado no cuelga el arranque', async () => {
    const pool = crearPoolMigraciones(URL_FICTICIA);
    try {
      expect(opciones(pool).lock_timeout).toBe(HUB_ESPERA_CANDADO_MIGRACION_MS);
      expect(HUB_ESPERA_CANDADO_MIGRACION_MS).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });
});

// DATA-332 — las migraciones pueden ir con su propio rol (el dueño del esquema,
// con DDL) mientras las peticiones van con uno que solo lee y escribe filas.
describe('con qué conexión corren las migraciones', () => {
  const PROPIA = 'postgres://migrador_ficticio:clave-ficticia@hub-ficticio.invalid:5432/zoho-hub';

  it('con HUB_MIGRATION_DB_URL, usan esa y no la de las peticiones', () => {
    expect(urlMigraciones(URL_FICTICIA, PROPIA)).toBe(PROPIA);
  });

  it('sin ella, la de siempre: activar la separación no puede ser requisito para arrancar', () => {
    expect(urlMigraciones(URL_FICTICIA, undefined)).toBe(URL_FICTICIA);
  });

  it('vacía o en blanco cuenta como ausente: una variable a medio quitar en EasyPanel no tumba el arranque', () => {
    expect(urlMigraciones(URL_FICTICIA, '')).toBe(URL_FICTICIA);
    expect(urlMigraciones(URL_FICTICIA, '   ')).toBe(URL_FICTICIA);
  });
});
