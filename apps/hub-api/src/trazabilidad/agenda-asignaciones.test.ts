import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ETAPAS_AGENDA, FLUJOS_AGENDA, PUESTOS_MAX } from './dominio.js';
import { CIERRES_ASIGNACION, MOTIVO_MAX, ORIGENES_ASIGNACION } from './types.js';

// Lote 4 de la agenda del taller: las guardas de las migraciones 052 y 053
// (se repiten en cada arranque: ni fallan ni cambian datos la segunda vez) y
// la de cuál es la última migración apuntada en db.ts. El SQL contra Postgres
// de verdad está en agenda-asignaciones.db.test.ts.

const leer = (fichero: string) => readFileSync(fileURLToPath(new URL(`../users/migrations/${fichero}`, import.meta.url)), 'utf8');
const lista = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const partes = (sql: string) => {
  const sinComentarios = sql.replace(/--.*$/gm, '');
  return {
    sinComentarios,
    sentencias: sinComentarios
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean),
  };
};

describe('052_trazabilidad_agenda_asignaciones.sql', () => {
  const SQL = leer('052_trazabilidad_agenda_asignaciones.sql');
  const { sinComentarios, sentencias } = partes(SQL);

  it('sólo crea con IF NOT EXISTS, sin semilla y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias).toHaveLength(5);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('las etapas, el tope de puestos, los orígenes y los cierres son los del código', () => {
    expect(lista(sinComentarios.match(/CHECK \(etapa IN \(([^)]*)\)\)/i)![1])).toEqual([...ETAPAS_AGENDA]);
    expect(sinComentarios).toMatch(new RegExp(`CHECK \\(puesto BETWEEN 1 AND ${PUESTOS_MAX}\\)`));
    expect(lista(sinComentarios.match(/CHECK \(origen IN \(([^)]*)\)\)/i)![1])).toEqual([...ORIGENES_ASIGNACION]);
    expect(lista(sinComentarios.match(/CHECK \(cierre IN \(([^)]*)\)\)/i)![1])).toEqual([...CIERRES_ASIGNACION]);
    expect(sinComentarios.match(new RegExp(`VARCHAR\\(${MOTIVO_MAX}\\)`, 'g'))).toHaveLength(2);
  });

  it('una vigente por ticket y un ocupante vigente por etapa y puesto: dos índices únicos parciales', () => {
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_ticket_uq ON portal\.tmc_agenda_asignaciones \(numero\) WHERE hasta IS NULL/);
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_puesto_uq ON portal\.tmc_agenda_asignaciones \(etapa, puesto\) WHERE hasta IS NULL/);
  });

  it('no toca el esquema desk ni pone claves foráneas, y nada de envíos', () => {
    expect(SQL).not.toMatch(/\bdesk\./);
    expect(SQL).not.toMatch(/\bREFERENCES\b/i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|cola|programad/i);
  });
});

describe('053_trazabilidad_agenda_flujo.sql', () => {
  const SQL = leer('053_trazabilidad_agenda_flujo.sql');
  const { sinComentarios, sentencias } = partes(SQL);

  it('sólo crea con IF NOT EXISTS, sin semilla, con los flujos del dominio y firmada', () => {
    expect(sentencias).toHaveLength(2);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE) IF NOT EXISTS /);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
    expect(lista(sinComentarios.match(/CHECK \(flujo IN \(([^)]*)\)\)/i)![1])).toEqual([...FLUJOS_AGENDA]);
    expect(sinComentarios).toMatch(/actualizado_por\s+VARCHAR\(254\)\s+NOT NULL/);
    expect(SQL).not.toMatch(/\bdesk\./);
    expect(SQL).not.toMatch(/\bREFERENCES\b/i);
  });

  it('las dos están apuntadas en MIGRATIONS, detrás de la 051, y la 053 es la última', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'051_trazabilidad_agenda_config\.sql',\s*'052_trazabilidad_agenda_asignaciones\.sql',\s*'053_trazabilidad_agenda_flujo\.sql'\]/);
  });
});
