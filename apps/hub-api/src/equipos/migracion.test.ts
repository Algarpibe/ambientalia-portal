import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// La 071 sin base: que está apuntada (y es la última) y que no siembra nada. Lo que
// hace contra Postgres: repo.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL = leer('../users/migrations/071_equipos_taller.sql');

describe('migración 071', () => {
  it('está apuntada en MIGRATIONS, detrás de la 070, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'070_wo_sales_documento_numero\.sql',\s*'071_equipos_taller\.sql'\];/);
  });

  it('no siembra ni apps ni llaves ni ninguna otra fila (se re-ejecuta en cada arranque)', () => {
    expect(SQL).not.toMatch(/INSERT\s+INTO/i);
    expect(SQL).not.toMatch(/user_apps/);
  });

  it('solo DDL idempotente', () => {
    const creates = SQL.match(/CREATE (UNIQUE )?(TABLE|INDEX|VIEW|SCHEMA|OR REPLACE VIEW)[^;]*/g) || [];
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.filter((c) => !/IF NOT EXISTS|OR REPLACE/.test(c))).toEqual([]);
  });
});
