import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORIAS_NOTA, ESTADOS_NOTA, MAX_COMENTARIO_NOTA, MIMES_IMAGEN_NOTA } from './types.js';

// Las notas personales sin base de datos: que la migración 076 está apuntada,
// es idempotente y da permisos a portal_app. Lo que hace contra Postgres lo
// vigila repo.notas.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL_076 = leer('../users/migrations/076_ausencias_notas.sql');
// Sin comentarios: el texto explicativo puede nombrar DROP o INSERT sin ser sentencia.
const SIN_COMENTARIOS = SQL_076.replace(/--.*$/gm, '');
const lista = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe('migración 076 (notas personales)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 075, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'075_equipos_tablero_tema_tv\.sql',\s*'076_ausencias_notas\.sql'\];/);
  });

  it('no siembra ni borra nada (se re-ejecuta en cada arranque)', () => {
    // ALTER también: un ALTER ... ADD CONSTRAINT no es re-ejecutable.
    expect(SIN_COMENTARIOS).not.toMatch(/INSERT\s+INTO|\b(DROP|TRUNCATE|ALTER)\b|DELETE\s+FROM/i);
  });

  it('solo DDL idempotente', () => {
    const creates = SIN_COMENTARIOS.match(/CREATE (UNIQUE )?(TABLE|INDEX|VIEW|SCHEMA|OR REPLACE VIEW)[^;]*/g) || [];
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.filter((c) => !/IF NOT EXISTS|OR REPLACE/.test(c))).toEqual([]);
  });

  it('CANDADO: los CHECK de la 076 dicen lo mismo que los tipos', () => {
    const listaDe = (col: string) => lista(SIN_COMENTARIOS.match(new RegExp(`CHECK \\(${col} IN \\(([^)]*)\\)\\)`, 'i'))![1]);
    const varchar = (col: string) => Number(SIN_COMENTARIOS.match(new RegExp(`\\b${col}\\s+VARCHAR\\((\\d+)\\)`, 'i'))![1]);
    const pares = [
      ['categoria', CATEGORIAS_NOTA],
      ['estado', ESTADOS_NOTA],
      ['mime', MIMES_IMAGEN_NOTA],
    ] as const;
    for (const [col, tipo] of pares) {
      const valores = listaDe(col);
      expect(valores, col).toEqual([...tipo]);
      for (const v of valores) expect(v.length, `${col}=${v}`).toBeLessThanOrEqual(varchar(col));
    }
    const tope = SIN_COMENTARIOS.match(/char_length\(comentario\) <= (\d+)/)![1];
    expect(Number(tope)).toBe(MAX_COMENTARIO_NOTA);
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

describe('index.ts', () => {
  it('CANDADO: /api/ausencias/notas tiene su parser de 12 MB, registrado ANTES del global de 2 MB', () => {
    // Si el de 2 MB corre primero, cualquier foto de móvil da 413 y este nunca
    // llega a verla. router.test.ts monta su propia app y no puede cazarlo.
    // Ancladas a la línea entera (flag `m`): una línea comentada no cuenta.
    // `\r?` por el CRLF de Windows.
    const index = leer('../index.ts');
    const propio = index.search(/^app\.use\('\/api\/ausencias\/notas', express\.json\(\{ limit: '12mb' \}\)\);\r?$/m);
    const global = index.search(/^app\.use\(express\.json\(\{ limit: '2mb' \}\)\);\r?$/m);
    expect(propio).toBeGreaterThanOrEqual(0);
    expect(global).toBeGreaterThanOrEqual(0);
    expect(propio).toBeLessThan(global);
  });
});
