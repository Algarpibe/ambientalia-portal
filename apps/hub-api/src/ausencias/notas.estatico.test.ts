import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Las notas personales sin base de datos: que la migración 076 está apuntada,
// es idempotente y da permisos a portal_app. Lo que hace contra Postgres lo
// vigila repo.notas.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL_076 = leer('../users/migrations/076_ausencias_notas.sql');

describe('migración 076 (notas personales)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 075, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'075_equipos_tablero_tema_tv\.sql',\s*'076_ausencias_notas\.sql'\];/);
  });

  it('no siembra ni borra nada (se re-ejecuta en cada arranque)', () => {
    expect(SQL_076).not.toMatch(/INSERT\s+INTO|\b(DROP|TRUNCATE)\b|DELETE\s+FROM/i);
  });

  it('solo DDL idempotente', () => {
    const creates = SQL_076.match(/CREATE (UNIQUE )?(TABLE|INDEX|VIEW|SCHEMA|OR REPLACE VIEW)[^;]*/g) || [];
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.filter((c) => !/IF NOT EXISTS|OR REPLACE/.test(c))).toEqual([]);
  });

  it('da permisos a portal_app solo si el rol existe (DATA-332)', () => {
    // La 068 concede ALL TABLES, pero corre ANTES que esta en el mismo arranque:
    // sin este GRANT la tabla nueva no tendría permisos hasta el boot siguiente.
    expect(SQL_076).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
    expect(SQL_076).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON portal\.ausencias_notas, portal\.ausencias_nota_imagenes TO portal_app/,
    );
  });
});
