import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Las migraciones de «Equipos en taller» sin base: que están apuntadas, en orden, que la 073
// es la última y que no siembran nada. Lo que hacen contra Postgres: migracion.db.test.ts,
// repo.db.test.ts y repo-sync.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL = leer('../users/migrations/071_equipos_taller.sql');
const SQL_072 = leer('../users/migrations/072_equipos_drive_n8n.sql');
const SQL_073 = leer('../users/migrations/073_equipos_origen_sincronizacion.sql');
const soloIdempotente = (sql: string) => {
  const creates = sql.match(/CREATE (UNIQUE )?(TABLE|INDEX|VIEW|SCHEMA|OR REPLACE VIEW)[^;]*/g) || [];
  expect(creates.length).toBeGreaterThan(0);
  expect(creates.filter((c) => !/IF NOT EXISTS|OR REPLACE/.test(c))).toEqual([]);
};

describe('migración 071', () => {
  it('está apuntada en MIGRATIONS, detrás de la 070', () => {
    expect(leer('../db.ts')).toMatch(/'070_wo_sales_documento_numero\.sql',\s*'071_equipos_taller\.sql'[,\]]/);
  });

  it('no siembra ni apps ni llaves ni ninguna otra fila (se re-ejecuta en cada arranque)', () => {
    expect(SQL).not.toMatch(/INSERT\s+INTO/i);
    expect(SQL).not.toMatch(/user_apps/);
  });

  it('solo DDL idempotente', () => soloIdempotente(SQL));
});

describe('migración 072 (Drive vía n8n)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 071', () => {
    expect(leer('../db.ts')).toMatch(/'071_equipos_taller\.sql',\s*'072_equipos_drive_n8n\.sql'[,\]]/);
  });

  it('no siembra nada', () => {
    expect(SQL_072).not.toMatch(/INSERT\s+INTO/i);
    expect(SQL_072).not.toMatch(/user_apps/);
  });

  it('solo DDL idempotente', () => soloIdempotente(SQL_072));

  it('no borra nada (se re-ejecuta en cada arranque)', () => {
    expect(SQL_072).not.toMatch(/\b(DROP|TRUNCATE)\b|DELETE\s+FROM/i);
  });

  it('da permisos a portal_app solo si el rol existe (DATA-332), también sobre la secuencia', () => {
    expect(SQL_072).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
    expect(SQL_072).toMatch(/GRANT USAGE, SELECT ON SEQUENCE portal\.equipos_sincronizacion_id_seq TO portal_app/);
  });
});

describe('migración 073 (origen «sincronizacion»)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 072, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'072_equipos_drive_n8n\.sql',\s*'073_equipos_origen_sincronizacion\.sql'\];/);
  });

  it('no siembra nada', () => {
    expect(SQL_073).not.toMatch(/INSERT\s+INTO/i);
    expect(SQL_073).not.toMatch(/user_apps/);
  });

  it('solo DDL idempotente', () => soloIdempotente(SQL_073));

  it('solo quita el CHECK del origen: ni tablas, ni filas', () => {
    expect(SQL_073).not.toMatch(/DROP\s+(TABLE|VIEW|INDEX|SCHEMA|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
    expect(SQL_073).toMatch(/DROP CONSTRAINT %I/);
  });

  it('el CHECK nuevo admite los tres orígenes (boton, por las filas viejas) y la guarda mira su contenido, no su nombre', () => {
    expect(SQL_073).toMatch(/ADD CONSTRAINT equipos_ejecucion_origen_check\s+CHECK \(origen IN \('programada', 'boton', 'sincronizacion'\)\)/);
    expect(SQL_073).toMatch(/pg_get_constraintdef\(oid\) LIKE '%sincronizacion%'/);
  });
});
