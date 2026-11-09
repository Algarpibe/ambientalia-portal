import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// El envío de los avisos a clientes (2026-11-08): su registro (069), su canal
// de salida y sus candados. Nada de aquí llama a la red: la red es de mentira.

const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('069_trazabilidad_avisos_envios.sql', () => {
  const sinComentarios = fuente('../users/migrations/069_trazabilidad_avisos_envios.sql').replace(/--.*$/gm, '');

  it('sólo crea, con IF NOT EXISTS, y da sus permisos a portal_app: sin semilla, sin claves foráneas y sin nada que cambie datos en un segundo arranque', () => {
    expect(sinComentarios).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+portal|DELETE\s+FROM|DROP|TRUNCATE|ALTER)\b/i);
    expect(sinComentarios.match(/CREATE (UNIQUE )?(TABLE|INDEX) (?!IF NOT EXISTS)/gi)).toBeNull();
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b|\bdesk\./i);
    expect(sinComentarios).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
  });

  it('un solo «en curso» por cliente y tramo: el índice único parcial', () => {
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_avisos_envios_en_curso_uq\s+ON portal\.tmc_avisos_envios \(clave_cliente, tramo\) WHERE estado = 'en_curso'/);
  });

  it('cuatro tramos, tres estados y dos modos, cerrados con CHECK (apagado no deja fila); y no guarda el cuerpo del correo', () => {
    expect(sinComentarios).toMatch(/tramo\s+VARCHAR\(10\)\s+NOT NULL CHECK \(tramo IN \('90', '60', '30', 'vencida'\)\)/);
    expect(sinComentarios).toMatch(/estado\s+VARCHAR\(10\)\s+NOT NULL DEFAULT 'en_curso' CHECK \(estado IN \('en_curso', 'enviado', 'fallido'\)\)/);
    expect(sinComentarios).toMatch(/modo\s+VARCHAR\(10\)\s+NOT NULL CHECK \(modo IN \('prueba', 'real'\)\)/);
    expect(sinComentarios).not.toMatch(/cuerpo/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 068, y es la última', () => {
    expect(fuente('../db.ts')).toMatch(/'068_permisos_portal_app\.sql',\s*'069_trazabilidad_avisos_envios\.sql'\];/);
  });
});
