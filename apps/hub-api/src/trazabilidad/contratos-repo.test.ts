import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { cambiarContrato, leerContrato, listarContratos } from './contratos-repo.js';

// La frecuencia de preventivo por cliente (lote 12, migración 064; decisión de Alfonso del 18/10/2026): Horiba se calibra con el
// preventivo, cuya frecuencia depende del CONTRATO de cada cliente. Un número de meses por cliente (o «sin contrato»), con firma, motivo
// e historial; sólo lo rellena un administrador del portal (`contrato.write`, de ningún rol). Y una marca puede vencer «según contrato».
const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('064_trazabilidad_contratos.sql', () => {
  const sinComentarios = fuente('../users/migrations/064_trazabilidad_contratos.sql').replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo crea con IF NOT EXISTS (tablas, columnas e índice): SIN SEMILLA, sin clave foránea y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias.map((s) => /^(CREATE (?:SCHEMA|TABLE|INDEX) IF NOT EXISTS \S+|ALTER TABLE \S+ ADD COLUMN IF NOT EXISTS \w+)/.exec(s)?.[1])).toEqual([
      'CREATE SCHEMA IF NOT EXISTS portal',
      'ALTER TABLE portal.tmc_marcas_vigencia ADD COLUMN IF NOT EXISTS contrato',
      'ALTER TABLE portal.tmc_marcas_vigencia_cambios ADD COLUMN IF NOT EXISTS antes_contrato',
      'ALTER TABLE portal.tmc_marcas_vigencia_cambios ADD COLUMN IF NOT EXISTS despues_contrato',
      'CREATE TABLE IF NOT EXISTS portal.tmc_contratos',
      'CREATE TABLE IF NOT EXISTS portal.tmc_contratos_cambios',
      'CREATE INDEX IF NOT EXISTS tmc_contratos_cambios_clave_idx',
    ]);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|SELECT|TRIGGER|DO)\b/i);
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b|\bdesk\.|tmc_equipos|en_seguimiento/i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|destinatari|email|correo/i);
  });

  it('«según contrato» en la marca: un booleano que nace en FALSE (nada cambia al desplegar) y que va sin días; el historial apunta antes y después', () => {
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS contrato BOOLEAN NOT NULL DEFAULT FALSE\s+CONSTRAINT tmc_marcas_vigencia_contrato_sin_dias CHECK \(NOT contrato OR dias IS NULL\)/);
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS antes_contrato BOOLEAN NOT NULL DEFAULT FALSE/);
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS despues_contrato BOOLEAN NOT NULL DEFAULT FALSE/);
  });

  it('la frecuencia por cliente: clave del cliente, meses de 1 a 36 o NULL (sin contrato), con motivo y firma; el historial, antes y después', () => {
    expect(sinComentarios).toMatch(/clave\s+VARCHAR\(200\)\s+PRIMARY KEY CHECK \(clave <> ''\)/);
    expect(sinComentarios).toMatch(/meses\s+INTEGER\s+NULL CHECK \(meses IS NULL OR meses BETWEEN 1 AND 36\)/);
    expect(sinComentarios).toMatch(/antes\s+INTEGER\s+NULL/);
    expect(sinComentarios).toMatch(/despues\s+INTEGER\s+NULL/);
    expect(sinComentarios.match(/motivo\s+TEXT\s+NOT NULL CHECK \(btrim\(motivo\) <> ''\)/g)).toHaveLength(2);
    expect(sinComentarios.match(/por\s+VARCHAR\(254\)\s+NOT NULL/g)).toHaveLength(2);
    expect(sinComentarios).not.toMatch(/\bserial\b/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 063', () => {
    expect(fuente('../db.ts')).toMatch(/'063_trazabilidad_vigencia_marcas\.sql',\s*'064_trazabilidad_contratos\.sql',/);
  });
});

type Filas = Record<string, unknown>[];
/** Un pool de mentira: contesta por patrón y apunta cada consulta con sus parámetros; las transacciones van por el mismo `query`. */
function doble(respuestas: [RegExp, Filas][]) {
  const sqls: { sql: string; p: unknown[] }[] = [];
  const query = async (sql: string, p: unknown[] = []) => (sqls.push({ sql, p }), { rows: respuestas.find(([r]) => r.test(sql))?.[1] ?? [] });
  const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Pool;
  return { pool, sqls, escrituras: () => sqls.filter((s) => /^\s*(INSERT|UPDATE|DELETE)/.test(s.sql)) };
}
const ACTOR = { userId: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com' };
const GUARDADA: [RegExp, Filas] = [/FROM portal\.tmc_contratos WHERE clave = \$1/, [{ clave: 'cliente ficticio a', cliente: 'Cliente Ficticio A', meses: 6, motivo: 'Contrato ficticio.', por: 'admin@example.com', en: '2026-10-18 15:00:00+00' }]];
const EN_INVENTARIO: [RegExp, Filas] = [/SELECT e\.cliente FROM/, [{ cliente: 'Cliente Ficticio A' }, { cliente: 'CLIENTE FICTICIO A ' }, { cliente: 'Cliente Ficticio A' }, { cliente: 'Cliente Ficticio B' }]];

describe('leer', () => {
  it('listarContratos: todas las frecuencias guardadas (también «sin contrato»), por cliente', async () => {
    const { pool, sqls } = doble([[/FROM portal\.tmc_contratos ORDER BY/, [GUARDADA[1][0], { ...GUARDADA[1][0], clave: 'cliente ficticio b', cliente: 'Cliente Ficticio B', meses: null }]]]);
    expect(await listarContratos(pool)).toEqual([
      { clave: 'cliente ficticio a', cliente: 'Cliente Ficticio A', meses: 6, motivo: 'Contrato ficticio.', por: 'admin@example.com', en: '2026-10-18 15:00:00+00' },
      { clave: 'cliente ficticio b', cliente: 'Cliente Ficticio B', meses: null, motivo: 'Contrato ficticio.', por: 'admin@example.com', en: '2026-10-18 15:00:00+00' },
    ]);
    for (const s of sqls) expect(s.sql).toMatch(/^\s*SELECT/);
  });

  it('leerContrato: la frecuencia de un cliente (o null) y su historial, el más reciente primero', async () => {
    const { pool, sqls } = doble([GUARDADA, [/FROM portal\.tmc_contratos_cambios/, [{ id: 2, clave: 'cliente ficticio a', cliente: 'Cliente Ficticio A', antes: null, despues: 6, motivo: 'Contrato ficticio.', por: 'admin@example.com', en: '2026-10-18 15:00:00+00' }]]]);
    const r = await leerContrato(pool, 'cliente ficticio a');
    expect(r.frecuencia?.meses).toBe(6);
    expect(r.cambios).toEqual([{ id: 2, clave: 'cliente ficticio a', cliente: 'Cliente Ficticio A', antes: null, despues: 6, motivo: 'Contrato ficticio.', por: 'admin@example.com', en: '2026-10-18 15:00:00+00' }]);
    expect(sqls.find((s) => /tmc_contratos_cambios/.test(s.sql))!.sql).toMatch(/ORDER BY id DESC/);
    expect((await leerContrato(doble([]).pool, 'cliente ficticio z')).frecuencia).toBeNull();
  });
});

describe('cambiarContrato', () => {
  it('en una transacción con su bloqueo: la frecuencia (con el nombre del cliente como más se escribe en el inventario) y su apunte, antes → después', async () => {
    const { pool, sqls, escrituras } = doble([EN_INVENTARIO]);
    await cambiarContrato(pool, 'cliente ficticio a', { meses: 6, motivo: 'Contrato ficticio de 6 meses.' }, ACTOR);
    expect(sqls.map((s) => s.sql.trim().split(/\s+/).slice(0, 1)[0])).toEqual(['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'INSERT', 'INSERT', 'COMMIT']);
    expect(sqls[1].sql).toMatch(/pg_advisory_xact_lock\(hashtext\('portal\.tmc_contratos'\)\)/);
    expect(escrituras().map((s) => /INSERT INTO ([a-z_.]+)/.exec(s.sql)![1])).toEqual(['portal.tmc_contratos', 'portal.tmc_contratos_cambios']);
    expect(escrituras()[0].p).toEqual(['cliente ficticio a', 'Cliente Ficticio A', 6, 'Contrato ficticio de 6 meses.', ACTOR.userId, ACTOR.email]);
    expect(escrituras()[1].p).toEqual(['cliente ficticio a', 'Cliente Ficticio A', null, 6, 'Contrato ficticio de 6 meses.', ACTOR.userId, ACTOR.email]);
  });

  it('volver a «sin contrato»: guarda null (queda quién y por qué) y apunta el valor de antes', async () => {
    const { pool, escrituras } = doble([GUARDADA, EN_INVENTARIO]);
    await cambiarContrato(pool, 'cliente ficticio a', { meses: null, motivo: 'Fin del contrato ficticio.' }, ACTOR);
    expect(escrituras()[0].p.slice(0, 3)).toEqual(['cliente ficticio a', 'Cliente Ficticio A', null]);
    expect(escrituras()[1].p.slice(2, 4)).toEqual([6, null]);
  });

  it('404 si el cliente no tiene ningún equipo activo en el inventario ni frecuencia guardada; con frecuencia guardada sí se cambia (su nombre, el guardado)', async () => {
    const nadie = doble([]);
    await expect(cambiarContrato(nadie.pool, 'cliente ficticio z', { meses: 6, motivo: 'x' }, ACTOR)).rejects.toMatchObject({ status: 404, code: 'not_found' });
    expect(nadie.escrituras()).toEqual([]);
    const guardada = doble([GUARDADA]);
    await cambiarContrato(guardada.pool, 'cliente ficticio a', { meses: 12, motivo: 'x' }, ACTOR);
    expect(guardada.escrituras()[0].p.slice(0, 3)).toEqual(['cliente ficticio a', 'Cliente Ficticio A', 12]);
  });

  it('409 `misma_frecuencia` si no cambia nada (también «sin contrato» sobre un cliente que no tenía): no escribe', async () => {
    const igual = doble([GUARDADA, EN_INVENTARIO]);
    await expect(cambiarContrato(igual.pool, 'cliente ficticio a', { meses: 6, motivo: 'x' }, ACTOR)).rejects.toMatchObject({ status: 409, code: 'misma_frecuencia' });
    const nunca = doble([EN_INVENTARIO]);
    await expect(cambiarContrato(nunca.pool, 'cliente ficticio b', { meses: null, motivo: 'x' }, ACTOR)).rejects.toMatchObject({ status: 409, code: 'misma_frecuencia' });
    expect([...igual.escrituras(), ...nunca.escrituras()]).toEqual([]);
  });
});

// CANDADO del lote 12. La frecuencia de un cliente mete o saca a sus equipos «según contrato» de Avisos: sólo un fichero escribe sus dos
// tablas, nadie cambia ni borra el historial, no toca equipos ni calibraciones, y nada de esto envía ni programa nada.
describe('CANDADO: quién escribe la frecuencia de un cliente', () => {
  const ficheros = ['./repo.ts', './hoja-repo.ts', './calibraciones-repo.ts', './exportacion-repo.ts', './maestro-repo.ts', './edicion-repo.ts', './retiros-repo.ts', './pasadas-nocturnas-repo.ts', './vigencia-repo.ts', './marcas-repo.ts', './contratos-repo.ts'];
  it('sólo contratos-repo.ts inserta en tmc_contratos y tmc_contratos_cambios; el historial no se cambia ni se borra; la frecuencia no se borra (null = sin contrato)', () => {
    expect(ficheros.filter((f) => /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+portal\.tmc_contratos/.test(fuente(f)))).toEqual(['./contratos-repo.ts']);
    for (const f of ficheros) expect(fuente(f), f).not.toMatch(/(UPDATE|DELETE\s+FROM|TRUNCATE)\s+portal\.tmc_contratos/);
  });

  it('contratos-repo.ts no escribe nada más: ni equipos, ni calibraciones, ni marcas; no nombra tmc_equipos (el cliente lo da repo.ts, del inventario)', () => {
    const src = fuente('./contratos-repo.ts');
    expect([...src.matchAll(/INSERT\s+INTO\s+([a-z_.]+)/g)].map((m) => m[1])).toEqual(['portal.tmc_contratos', 'portal.tmc_contratos_cambios']);
    expect(src).not.toMatch(/\bUPDATE\s+portal\.|\bDELETE\b|tmc_equipos|tmc_calibraciones|tmc_marcas/);
  });

  it('nada de la frecuencia avisa a nadie ni programa nada', () => {
    expect(fuente('./contratos-repo.ts')).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
  });
});
