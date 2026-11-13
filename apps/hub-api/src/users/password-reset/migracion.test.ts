import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// La migración 077 sin base de datos: que está apuntada, que se puede repetir
// en cada arranque, que guarda la huella y no el token, y que da permisos a
// portal_app. Lo que hace contra Postgres lo vigila
// password-reset.repository.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL_077 = leer('../migrations/077_password_reset_tokens.sql');
// Sin comentarios: el texto explicativo puede nombrar DROP o INSERT sin ser sentencia.
const SIN_COMENTARIOS = SQL_077.replace(/--.*$/gm, '');

describe('migración 077 (tokens de restablecimiento de contraseña)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 076, y es la última', () => {
    expect(leer('../../db.ts')).toMatch(/'076_ausencias_notas\.sql',\s*'077_password_reset_tokens\.sql'\];/);
  });

  it('no siembra, ni cambia, ni borra nada (se re-ejecuta en cada arranque)', () => {
    expect(SIN_COMENTARIOS).not.toMatch(/INSERT\s+INTO|UPDATE\s+portal|\b(DROP|TRUNCATE|ALTER)\b|DELETE\s+FROM/i);
  });

  it('solo DDL idempotente: una tabla y un índice, los dos IF NOT EXISTS', () => {
    const creates = SIN_COMENTARIOS.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^;]*/g) || [];
    expect(creates).toHaveLength(2);
    expect(creates.filter((c) => !/IF NOT EXISTS/.test(c))).toEqual([]);
  });

  it('guarda la huella del token (única), nunca el token, y se borra con el usuario', () => {
    expect(SIN_COMENTARIOS).toMatch(/token_hash\s+TEXT NOT NULL UNIQUE/);
    expect(SIN_COMENTARIOS).not.toMatch(/\btoken\s+TEXT/i);
    expect(SIN_COMENTARIOS).toMatch(/REFERENCES portal\.users\(id\) ON DELETE CASCADE/);
  });

  it('da sus permisos a portal_app si existe (DATA-332)', () => {
    expect(SIN_COMENTARIOS).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
    expect(SIN_COMENTARIOS).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON portal\.password_reset_tokens TO portal_app/);
  });
});
