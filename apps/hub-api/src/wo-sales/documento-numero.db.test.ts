import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { asignarDocumentoNumeros, BLOQUEO_NUMERACION } from './documento-numero.repo.js';
import { poolDePrueba } from '../test-db/harness.js';

// DocumentoNúmero persistente (§8.1) contra Postgres de verdad: la siembra de la migración, la
// asignación MAX + 1 y la carrera entre dos generaciones simultáneas solo se ven con el motor real.

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  // Las congeladas son de la migración y se conservan; se borra solo lo que asignan los tests
  // (email.db.test.ts también asigna, a su 'OV-1').
  await db.query(`DELETE FROM portal.wo_sales_documento_numero WHERE origen = 'asignado'`);
});

interface Fila {
  numero_ov: string;
  documento_numero: number;
  origen: string;
}

async function filas(): Promise<Fila[]> {
  const { rows } = await db.query(
    `SELECT numero_ov, documento_numero, origen FROM portal.wo_sales_documento_numero ORDER BY documento_numero`,
  );
  return rows as Fila[];
}

describe('migración 070: siembra del archivo del 31/10', () => {
  it('congela las 37 OV ya cargadas en WO más la 212, del 1 al 38 sin huecos', async () => {
    const congeladas = (await filas()).filter((f) => f.origen === 'congelado');
    expect(congeladas.map((f) => f.documento_numero)).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
    expect(congeladas[0].numero_ov).toBe('OV-2022-105');
    expect(congeladas[36].numero_ov).toBe('OV-2026-211');
    expect(congeladas[37].numero_ov).toBe('OV-2026-212'); // ya facturada: congelada para que la 213 sea la 39
  });

  it('re-ejecutarla (initDb lo hace en cada arranque) no duplica ni cambia nada', async () => {
    await asignarDocumentoNumeros(db, ['OV-2026-213']);
    const ruta = fileURLToPath(new URL('../users/migrations/070_wo_sales_documento_numero.sql', import.meta.url));
    await db.query(readFileSync(ruta, 'utf8'));
    const todas = await filas();
    expect(todas).toHaveLength(39);
    expect(todas.find((f) => f.numero_ov === 'OV-2026-213')?.documento_numero).toBe(39);
    expect(todas.find((f) => f.numero_ov === 'OV-2026-212')?.documento_numero).toBe(38);
    expect(todas.find((f) => f.numero_ov === 'OV-2026-211')?.documento_numero).toBe(37);
  });
});

describe('asignarDocumentoNumeros', () => {
  it('una OV congelada conserva su número', async () => {
    const m = await asignarDocumentoNumeros(db, ['OV-2026-211', 'OV-2026-212', 'OV-2025-030']);
    expect(Object.fromEntries(m)).toEqual({ 'OV-2026-211': 37, 'OV-2026-212': 38, 'OV-2025-030': 2 });
  });

  it('la primera OV nueva recibe el 39 (la 212 está congelada con el 38)', async () => {
    const m = await asignarDocumentoNumeros(db, ['OV-2026-213']);
    expect(m.get('OV-2026-213')).toBe(39);
  });

  it('un lote se reparte por número de OV, no por orden de entrada: la 213 antes que la 214', async () => {
    const m = await asignarDocumentoNumeros(db, ['OV-2026-214', 'OV-2026-213', 'OV-2026-211']);
    expect(Object.fromEntries(m)).toEqual({ 'OV-2026-211': 37, 'OV-2026-213': 39, 'OV-2026-214': 40 });
  });

  it('pedir otra vez las mismas OV devuelve los mismos números sin crear filas', async () => {
    const primera = await asignarDocumentoNumeros(db, ['OV-2026-213', 'OV-2026-214']);
    const segunda = await asignarDocumentoNumeros(db, ['OV-2026-214', 'OV-2026-213']);
    expect(Object.fromEntries(segunda)).toEqual(Object.fromEntries(primera));
    expect((await filas()).filter((f) => f.origen === 'asignado')).toHaveLength(2);
  });

  it('una OV que sale del archivo (facturada) no libera su número', async () => {
    await asignarDocumentoNumeros(db, ['OV-2026-213', 'OV-2026-214']);
    // La 213 se facturó y ya no se pide; entra la 215.
    const m = await asignarDocumentoNumeros(db, ['OV-2026-214', 'OV-2026-215']);
    expect(Object.fromEntries(m)).toEqual({ 'OV-2026-214': 40, 'OV-2026-215': 41 });
  });

  it('dos asignaciones a la vez no repiten número ni dejan huecos', async () => {
    // Determinista: otra sesión tiene el candado; las dos asignaciones se quedan esperándolo
    // (se ve en pg_stat_activity, por el texto de la consulta) y solo entonces se suelta.
    const otro = await db.connect();
    let pa: Promise<Map<string, number>> | undefined;
    let pb: Promise<Map<string, number>> | undefined;
    try {
      await otro.query('BEGIN');
      await otro.query(BLOQUEO_NUMERACION);
      pa = asignarDocumentoNumeros(db, ['OV-2026-213', 'OV-2026-214']);
      pb = asignarDocumentoNumeros(db, ['OV-2026-214', 'OV-2026-215']);

      let esperando = 0;
      for (let i = 0; i < 30 && esperando < 2; i++) {
        const { rows } = await db.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND query = $1`,
          [BLOQUEO_NUMERACION],
        );
        esperando = (rows[0] as { n: number }).n;
        if (esperando < 2) await new Promise((r) => setTimeout(r, 100));
      }
      expect(esperando).toBe(2);

      await otro.query('COMMIT');
      const [a, b] = await Promise.all([pa, pb]);
      expect(a.get('OV-2026-214')).toBe(b.get('OV-2026-214'));
      const nuevos = (await filas()).filter((f) => f.origen === 'asignado').map((f) => f.documento_numero);
      expect(nuevos).toEqual([39, 40, 41]);
    } finally {
      // release(true) destruye la conexión: si el test falló a medias, la transacción aborta
      // y el candado se libera.
      otro.release(true);
      await Promise.allSettled([pa, pb]);
    }
  });

  it('un número de OV repetido en la entrada cuenta una sola vez', async () => {
    const m = await asignarDocumentoNumeros(db, ['OV-2026-213', 'OV-2026-213']);
    expect(Object.fromEntries(m)).toEqual({ 'OV-2026-213': 39 });
  });

  it('sin OV devuelve un mapa vacío y no crea filas', async () => {
    const m = await asignarDocumentoNumeros(db, []);
    expect(m.size).toBe(0);
    expect(await filas()).toHaveLength(38);
  });
});
