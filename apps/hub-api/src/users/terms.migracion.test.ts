import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// La migración 079 sin base de datos: que está apuntada (y es la última), que se
// puede repetir en cada arranque, que guarda lo mínimo y se borra con la cuenta,
// y que da permisos a portal_app. Lo que hace contra Postgres lo vigila
// terms.db.test.ts (con Docker).
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL_079 = leer('./migrations/079_terms_acceptances.sql');
// Sin comentarios: el texto explicativo puede nombrar DROP o IP sin ser sentencia.
const SIN_COMENTARIOS = SQL_079.replace(/--.*$/gm, '');

describe('migración 079 (aceptaciones de las condiciones de uso)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 078, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'078_equipos_responsable\.sql',\s*'079_terms_acceptances\.sql'\];/);
  });

  it('no siembra, ni cambia, ni borra nada (se re-ejecuta en cada arranque)', () => {
    // Se quitan antes los GRANT/REVOKE: sus listas de privilegios nombran UPDATE, DELETE
    // y TRUNCATE sin ser sentencias destructivas. Lo que queda se vigila a rajatabla,
    // así que cualquier TRUNCATE (con o sin ONLY, calificado o no) sigue fallando.
    const SIN_PERMISOS = SIN_COMENTARIOS.replace(/\b(GRANT|REVOKE)\b[^;]*;/gi, '');
    expect(SIN_PERMISOS).not.toMatch(/INSERT\s+INTO|UPDATE\s+portal|\b(DROP|TRUNCATE|ALTER)\b|DELETE\s+FROM/i);
  });

  it('solo DDL idempotente: una tabla, IF NOT EXISTS', () => {
    const creates = SIN_COMENTARIOS.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^;]*/g) || [];
    expect(creates).toHaveLength(1);
    expect(creates.filter((c) => !/IF NOT EXISTS/.test(c))).toEqual([]);
  });

  it('guarda usuario, versión y fecha y nada más (ni IP ni navegador), y se borra con la cuenta', () => {
    expect(SIN_COMENTARIOS).toMatch(/user_id\s+UUID NOT NULL REFERENCES portal\.users\(id\) ON DELETE CASCADE/);
    expect(SIN_COMENTARIOS).toMatch(/version\s+TEXT NOT NULL/);
    expect(SIN_COMENTARIOS).toMatch(/accepted_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
    expect(SIN_COMENTARIOS).toMatch(/PRIMARY KEY \(user_id, version\)/);
    expect(SIN_COMENTARIOS).not.toMatch(/\b(ip|user_agent)\b/i);
  });

  it('da sus permisos a portal_app si existe (DATA-332)', () => {
    expect(SIN_COMENTARIOS).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
    expect(SIN_COMENTARIOS).toMatch(/GRANT SELECT, INSERT ON portal\.terms_acceptances TO portal_app/);
    expect(SIN_COMENTARIOS).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE ON portal\.terms_acceptances FROM portal_app/);
  });
});
