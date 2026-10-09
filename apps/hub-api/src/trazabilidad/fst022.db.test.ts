import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import type { Celda } from './fst022.js';
import * as repo from './repo.js';
import { TzError, parseCongelacion, type NuevaCongelacion } from './types.js';

// Lote 9a contra Postgres: la migración 055 repetida, una sola congelación
// vigente, volver a congelar sin perder la anterior, que las filas congeladas
// no cambian y que congelar es todo o nada. Hoja ficticia: clientes y seriales
// inventados (el repo es público).

let db: Pool;
const SQL_055 = readFileSync(fileURLToPath(new URL('../users/migrations/055_trazabilidad_fst022_congelacion.sql', import.meta.url)), 'utf8');
const dt = { userId: '00000000-0000-4000-8000-000000000001', email: 'director@example.com' };
const admin = { userId: '00000000-0000-4000-8000-000000000002', email: 'admin@example.com' };

const CABECERA: Celda[][] = [
  ['Cliente', 'Marca', 'Modelo', 'Serial', 'Hoja Vida', '(Última entrada)', 'Días', 'Mantenimientos', null, null, 'Última Calibración'],
  [null, null, null, null, null, null, null, 'P', 'Correctivo', 'Calibración'],
];
const hoja = (extra: Celda[][] = []): Celda[][] => [
  ...CABECERA,
  ['Cliente Ficticio A', 'Grimm', 'EDM 180C', '18a00001', { v: 'HV_18A00001', enlace: 'https://docs.example/hv/1' }, { v: '2026-01-10', t: 'fecha' }, 12, 1, 0, 2, { v: '2025-10-17', t: 'fecha' }],
  ['Cliente Ficticio B', 'HORIBA', 'APNA-370', 1.8e15, null, 'No hay datos', { v: '#VALUE!', t: 'error' }, 0, 0, 0, { v: '1900-12-30', t: 'fecha' }],
  [],
  ['total equipos', 2],
  ...extra,
];
const cuerpo = (matriz: Celda[][], extra: Record<string, unknown> = {}): NuevaCongelacion => parseCongelacion({ archivo: 'F-ST-022 ficticia.xlsx', sha256: 'ab'.repeat(32), hoja: 'Trazabilidad', matriz, ...extra });
const congelar = (c: NuevaCongelacion, actor = dt, esAdmin = false, simular = false) => repo.congelarFst022(db, c, actor, esAdmin, simular);
const cuenta = async (tabla: string) => Number((await db.query(`SELECT count(*)::int AS n FROM portal.${tabla}`)).rows[0].n);
const filasDe = async (id: number) =>
  (await db.query(`SELECT fila, celdas, es_equipo, serial_norm, clave_equipo FROM portal.tmc_fst022_congelada WHERE congelacion_id = $1 ORDER BY fila`, [id])).rows as { fila: number; celdas: Celda[]; es_equipo: boolean; serial_norm: string | null; clave_equipo: string | null }[];
const fallo = async (p: Promise<unknown>): Promise<TzError> => p.then(() => { throw new Error('no falló'); }, (e) => e as TzError);

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE portal.tmc_fst022_congelada, portal.tmc_fst022_congelaciones, portal.tmc_equipos, portal.tmc_importaciones RESTART IDENTITY');
});

describe('migración 055', () => {
  it('no siembra nada, y ejecutarla dos veces más no falla ni toca lo congelado', async () => {
    expect(await cuenta('tmc_fst022_congelaciones')).toBe(0);
    const { congelacion } = await congelar(cuerpo(hoja()));
    const antes = [await repo.listarCongelaciones(db), await filasDe(congelacion!.id)];
    await db.query(SQL_055);
    await db.query(SQL_055);
    expect([await repo.listarCongelaciones(db), await filasDe(congelacion!.id)]).toEqual(antes);
  });

  it('la tabla no admite dos vigentes, ni una reemplazada sin firma, ni una fila sin su congelación', async () => {
    await congelar(cuerpo(hoja()));
    const otra = (vigente: boolean) =>
      db.query(
        `INSERT INTO portal.tmc_fst022_congelaciones (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas, vigente, por)
         VALUES ('x.xlsx', $1, 'T', 1, '[]', 1, 1, 1, 0, 0, 0, '{}', $2, 'alguien@example.com')`,
        ['cd'.repeat(32), vigente],
      );
    await expect(otra(true)).rejects.toThrow(/tmc_fst022_congelaciones_vigente_uq/);
    await expect(otra(false)).rejects.toThrow(/tmc_fst022_vigente_o_reemplazada/);
    await expect(db.query(`INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo) VALUES (999, 1, '[]', false)`)).rejects.toThrow(/foreign key/i);
  });
});

describe('congelarFst022', () => {
  it('simular devuelve el resumen y no escribe nada', async () => {
    const r = await congelar(cuerpo(hoja()), dt, false, true);
    expect(r).toMatchObject({ simulado: true, congelacion: null, anterior: null, archivo: 'F-ST-022 ficticia.xlsx', hoja: 'Trazabilidad', resumen: { totalFilas: 6, filasGuardadas: 5, filasEquipo: 2, filasEdm180: 1, filasOtras: 3 } });
    expect(r.titulos.slice(0, 4)).toEqual(['Cliente', 'Marca', 'Modelo', 'Serial']);
    expect(await cuenta('tmc_fst022_congelaciones')).toBe(0);
    expect(await cuenta('tmc_fst022_congelada')).toBe(0);
  });

  it('la primera congelación guarda la hoja entera tal cual, con sus columnas derivadas, y queda vigente y firmada', async () => {
    const { congelacion, simulado, anterior } = await congelar(cuerpo(hoja()));
    expect(simulado).toBe(false);
    expect(anterior).toBeNull();
    expect(congelacion).toMatchObject({ id: 1, archivo: 'F-ST-022 ficticia.xlsx', sha256: 'ab'.repeat(32), hoja: 'Trazabilidad', vigente: true, motivo: null, por: 'director@example.com', reemplazadaPor: null, reemplazadaEn: null, totalFilas: 6, totalColumnas: 11, filasGuardadas: 5, filaCabecera: 1, filasEquipo: 2, filasConSerial: 2, filasEdm180: 1, filasOtras: 3 });
    expect(congelacion!.problemas).toMatchObject({ serial_cientifico: 1, error_excel: 1, texto_en_fecha: 1, fecha_imposible: 1, sin_serial: 0 });
    const filas = await filasDe(1);
    expect(filas.map((f) => [f.fila, f.es_equipo, f.serial_norm, f.clave_equipo])).toEqual([[1, false, null, null], [2, false, null, null], [3, true, '18A00001', '18a00001'], [4, true, '1800000000000000', null], [6, false, null, null]]);
    expect(filas.map((f) => f.celdas)).toEqual(hoja().filter((r) => r.length > 0));
    const firma = await db.query(`SELECT por_id::text, cabeceras FROM portal.tmc_fst022_congelaciones WHERE id = 1`);
    expect(firma.rows[0]).toEqual({ por_id: dt.userId, cabeceras: CABECERA });
    // No toca el inventario ni el registro de importaciones: la importación de siempre va aparte.
    expect(await cuenta('tmc_equipos')).toBe(0);
    expect(await cuenta('tmc_importaciones')).toBe(0);
  });

  it('con una vigente, quien no es administrador del portal no puede volver a congelar (409), tampoco simulando, y nada cambia', async () => {
    await congelar(cuerpo(hoja()));
    for (const simular of [true, false]) {
      const e = await fallo(congelar(cuerpo(hoja(), { motivo: 'Quiero otra' }), dt, false, simular));
      expect(e).toBeInstanceOf(TzError);
      expect([e.status, e.code]).toEqual([409, 'congelacion_vigente']);
      expect(e.messageEs).toMatch(/Ya hay una congelación vigente.*administrador del portal/);
    }
    expect((await repo.listarCongelaciones(db)).map((c) => [c.id, c.vigente])).toEqual([[1, true]]);
  });

  it('un administrador vuelve a congelar sólo con motivo; la anterior deja de ser la vigente, queda firmada y conserva sus filas idénticas', async () => {
    await congelar(cuerpo(hoja()));
    const antes = await filasDe(1);
    const sinMotivo = await fallo(congelar(cuerpo(hoja()), admin, true));
    expect([sinMotivo.status, sinMotivo.field]).toEqual([400, 'motivo']);
    // Simulando no hace falta el motivo: se escribe al confirmar.
    expect((await congelar(cuerpo(hoja()), admin, true, true)).anterior).toMatchObject({ id: 1, vigente: true });

    const nueva = hoja([['Cliente Ficticio C', 'Grimm', 'EDM 180D', '18D00009']]);
    const r = await congelar(cuerpo(nueva, { motivo: 'Se añadió un equipo', sha256: 'ef'.repeat(32) }), admin, true);
    expect(r.anterior).toMatchObject({ id: 1 });
    expect(r.congelacion).toMatchObject({ id: 2, vigente: true, motivo: 'Se añadió un equipo', por: 'admin@example.com', filasEquipo: 3 });
    const lista = await repo.listarCongelaciones(db);
    expect(lista.map((c) => [c.id, c.vigente, c.reemplazadaPor, c.reemplazadaMotivo])).toEqual([[2, true, null, null], [1, false, 'admin@example.com', 'Se añadió un equipo']]);
    expect(lista[1].reemplazadaEn).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(await filasDe(1)).toEqual(antes);
    expect(await filasDe(2)).toHaveLength(6);
  });

  it('todo o nada: si falla guardar una fila no queda ni la congelación nueva ni la anterior deja de ser la vigente, y el error no arrastra el contenido de la hoja', async () => {
    await congelar(cuerpo(hoja()));
    const mala = cuerpo(hoja(), { motivo: 'Otra vez' });
    // Postgres no admite \u0000 en un jsonb. La validación lo para antes (400); aquí se salta para romper la escritura a mitad.
    mala.preparada.filas[2].celdas[0] = 'Cliente Reservado \u0000';
    const e = (await fallo(congelar(mala, admin, true))) as unknown as Error & { detail?: string; where?: string };
    expect(e).not.toBeInstanceOf(TzError);
    expect(`${e.message} ${e.detail ?? ''} ${e.where ?? ''} ${String(e.stack)}`).not.toMatch(/Reservado|18A0/i);
    expect((await repo.listarCongelaciones(db)).map((c) => [c.id, c.vigente, c.reemplazadaEn])).toEqual([[1, true, null]]);
    expect(await cuenta('tmc_fst022_congelada')).toBe(5);
  });

  it('dos primeras congelaciones a la vez: una entra y la otra recibe el 409', async () => {
    const r = await Promise.allSettled([congelar(cuerpo(hoja())), congelar(cuerpo(hoja()))]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: 'congelacion_vigente' });
    expect(await cuenta('tmc_fst022_congelaciones')).toBe(1);
  });
});

describe('leer la congelación', () => {
  it('sin ninguna, la vigente es null y la lista está vacía', async () => {
    expect(await repo.listarCongelaciones(db)).toEqual([]);
    expect(await repo.congelacionVigente(db, { desde: 0, limite: 500 })).toEqual({ congelacion: null, cabeceras: [], filas: [], siguiente: null });
  });

  it('la vigente trae sus metadatos, sus cabeceras y sus filas por páginas, en el orden de la hoja', async () => {
    await congelar(cuerpo(hoja()));
    const p1 = await repo.congelacionVigente(db, { desde: 0, limite: 3 });
    expect(p1.congelacion).toMatchObject({ id: 1, vigente: true });
    expect(p1.cabeceras).toEqual(CABECERA);
    expect(p1.filas.map((f) => f.fila)).toEqual([1, 2, 3]);
    expect(p1.filas[2]).toEqual({ fila: 3, celdas: hoja()[2], esEquipo: true, serialNorm: '18A00001', claveEquipo: '18a00001' });
    expect(p1.siguiente).toBe(3);
    const p2 = await repo.congelacionVigente(db, { desde: p1.siguiente!, limite: 3 });
    expect(p2.filas.map((f) => f.fila)).toEqual([4, 6]);
    expect(p2.siguiente).toBeNull();
  });
});
