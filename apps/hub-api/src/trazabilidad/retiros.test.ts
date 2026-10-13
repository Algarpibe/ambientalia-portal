import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TzError, parseObjetoRetiro } from './types.js';

// Retirar y reincorporar (lote 9d-2b), sin base: las guardas de la 059, qué
// escribe su SQL y el validador de «de quién es el historial». El plan del maestro con retirados a mano está en maestro.test.ts;
// la tabla de la pestaña, en hoja.test.ts; el SQL, en retiros.db.test.ts.

const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('059_trazabilidad_retiros.sql', () => {
  const sinComentarios = fuente('../users/migrations/059_trazabilidad_retiros.sql').replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo añade columnas y crea con IF NOT EXISTS: sin semilla y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias).toHaveLength(7);
    for (const s of sentencias) expect(s).toMatch(/^(ALTER TABLE portal\.tmc_equipos ADD COLUMN IF NOT EXISTS retirado_\w+ |CREATE (TABLE|INDEX) IF NOT EXISTS )/);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b|\bdesk\./i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|cola|programad/i);
  });

  it('la marca de «retirado a mano» son cuatro columnas que nacen vacías: nadie queda retirado por desplegar; y NO toca `en_seguimiento` ni la congelación', () => {
    expect(sentencias.slice(0, 4)).toEqual([
      'ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS retirado_en TIMESTAMPTZ NULL',
      'ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS retirado_por_id UUID NULL',
      'ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS retirado_por VARCHAR(254) NULL',
      'ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS retirado_motivo TEXT NULL',
    ]);
    expect(sinComentarios).not.toMatch(/en_seguimiento|tmc_fst022|\bactivo\b/i);
  });

  it('tmc_retiros: una fila por retiro o reincorporación (no se cambia ni se borra), de un equipo O de una fila de la hoja, con motivo, valor anterior y nuevo, y firma', () => {
    expect(sinComentarios).toMatch(/CREATE TABLE IF NOT EXISTS portal\.tmc_retiros/);
    expect(sinComentarios).toMatch(/accion\s+VARCHAR\(12\)\s+NOT NULL CHECK \(accion IN \('retirar', 'reincorporar'\)\)/);
    expect(sinComentarios).toMatch(/motivo\s+TEXT\s+NOT NULL CHECK \(btrim\(motivo\) <> ''\)/);
    expect(sinComentarios).toMatch(/antes\s+VARCHAR\(12\)\s+NOT NULL/);
    expect(sinComentarios).toMatch(/despues\s+VARCHAR\(12\)\s+NOT NULL/);
    expect(sinComentarios).toMatch(/por\s+VARCHAR\(254\)\s+NOT NULL/);
    expect(sinComentarios).toMatch(/CONSTRAINT tmc_retiros_objeto CHECK \(\(clave IS NULL\) <> \(fila IS NULL\) AND \(fila IS NULL\) = \(congelacion_id IS NULL\)\)/);
  });

  // Cuál es la última lo vigila exportacion.test.ts (la 060, lote 9e).
  it('está apuntada en MIGRATIONS, detrás de la 058', () => {
    expect(fuente('../db.ts')).toMatch(/'058_trazabilidad_en_seguimiento\.sql',\s*'059_trazabilidad_retiros\.sql',/);
  });
});

describe('CANDADO: qué escribe retirar y reincorporar', () => {
  const src = fuente('./retiros-repo.ts');

  it('sólo marca el equipo y apunta el retiro: nada se borra, y ni la congelación, ni el seguimiento, ni las calibraciones, ni `en_seguimiento`', () => {
    const escrituras = [...src.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+([a-z_.0-9]+)/g)].map((m) => `${m[1].replace(/\s+/g, ' ')} ${m[2]}`);
    expect(escrituras.sort()).toEqual(['INSERT INTO portal.tmc_retiros', 'UPDATE portal.tmc_equipos']);
    const update = /UPDATE portal\.tmc_equipos[^`]*/.exec(src)![0];
    const set = update.slice(0, update.indexOf('WHERE'));
    expect(set).toMatch(/SET activo = /);
    expect(set).toMatch(/retirado_en = /);
    // Lo único que cambia de un equipo: si está activo y su marca de retirado. Cliente, marca, modelo y serial son del maestro.
    expect(set).not.toMatch(/\b(cliente|marca|modelo|serial|clave|desk_id|origen|ultima_calibracion|en_seguimiento)\s*=/);
    expect(update).toMatch(/WHERE e\.clave = \$1$/);
    expect(src).not.toMatch(/en_seguimiento\s*=/);
    expect(src).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)[^;`]*tmc_fst022_\w+/i);
    expect(src).not.toMatch(/tmc_seguimiento|tmc_contactos|tmc_calibraciones|db-desk2|getDesk2Pool|\bdesk\./);
  });

  it('NINGÚN CORREO ni programador: retirar es marcar', () => {
    expect(src).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
  });

  it('la sincronización del maestro respeta la marca también en su SQL: `activo` sólo sigue al maestro si el equipo no está retirado a mano', () => {
    expect(fuente('./maestro-repo.ts')).toMatch(/activo = x\.activo AND e\.retirado_en IS NULL/);
  });
});

describe('parseObjetoRetiro (de quién es el historial de retiros)', () => {
  const error = (q: Record<string, unknown>) => {
    try {
      parseObjetoRetiro(q);
    } catch (e) {
      if (e instanceof TzError) return [e.status, e.field];
    }
    return null;
  };

  it('?clave= de un equipo o ?fila= de la hoja; ni ninguna ni las dos', () => {
    expect(parseObjetoRetiro({ clave: '18A00001' })).toEqual({ clave: '18A00001', fila: null });
    expect(parseObjetoRetiro({ fila: '37' })).toEqual({ clave: null, fila: 37 });
    expect(error({})).toEqual([400, 'clave']);
    expect(error({ clave: '18A00001', fila: '37' })).toEqual([400, 'clave']);
    expect(error({ clave: 'a b' })).toEqual([400, 'clave']);
    expect(error({ fila: '0' })).toEqual([400, 'fila']);
    expect(error({ fila: ['1', '2'] })).toEqual([400, 'fila']);
  });
});
