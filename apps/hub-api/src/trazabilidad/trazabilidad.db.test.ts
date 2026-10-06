import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import * as repo from './repo.js';
import type { FilaImportada } from './types.js';

// El SQL de verdad contra Postgres: importación, reimportación (altas, cambios,
// retiradas), seguimiento y avisos en bloque.

let db: Pool;
const actor = { userId: '00000000-0000-4000-8000-000000000001', email: 'st@ambientalia.com.co' };
const hoy = '2026-10-06';

const fila = (serial: string, cliente: string, ultimaCalibracion: string | null, extra: Partial<FilaImportada> = {}): FilaImportada => ({
  serial,
  cliente,
  marca: 'Grimm',
  modelo: 'EDM 180C',
  fechaFactura: '2019-03-04',
  hojaVida: `HV_${serial}_EDM180C`,
  ultimaEntrada: null,
  ultimaCalibracion,
  entradasSt: 1,
  calibracionesPeriodo: 2,
  correctivosPeriodo: 0,
  ...extra,
});

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_importaciones RESTART IDENTITY');
});

describe('importar', () => {
  it('da de alta, calcula el estado y marca los seriales repetidos', async () => {
    const r = await repo.importar(
      db,
      { archivo: 'F-ST-022.xlsx', filas: [fila('18A00006', 'Cliente Cuatro', '2025-10-17'), fila('18A00004', 'Cliente Cinco', '2024-03-26'), fila('18A00004', 'Cliente Seis', '2024-03-26')] },
      actor,
      false,
    );
    expect(r).toMatchObject({ total: 3, nuevos: 3, actualizados: 0, retirados: 0, por: actor.email });

    const eq = await repo.listarEquipos(db, hoy);
    expect(eq.map((e) => e.clave).sort()).toEqual(['18A00004', '18A00004-2', '18A00006']);
    const chem = eq.find((e) => e.clave === '18A00006')!;
    expect(chem).toMatchObject({ vence: '2026-10-17', vigenciaDias: 11, estado: 'VENCE_30', serialRepetido: false, seguimiento: null });
    expect(eq.find((e) => e.clave === '18A00004-2')).toMatchObject({ cliente: 'Cliente Seis', serialRepetido: true, estado: 'FUERA_CICLO' });
    expect(await repo.ultimaImportacion(db)).toMatchObject({ archivo: 'F-ST-022.xlsx', total: 3 });
  });

  it('simular cuenta sin escribir', async () => {
    const r = await repo.importar(db, { archivo: 'x.xlsx', filas: [fila('A1', 'C', null)] }, actor, true);
    expect(r).toMatchObject({ id: null, nuevos: 1 });
    expect(await repo.listarEquipos(db, hoy)).toEqual([]);
    expect(await repo.ultimaImportacion(db)).toBeNull();
  });

  it('reimportar: actualiza lo que cambia, retira lo que falta y conserva el seguimiento', async () => {
    await repo.importar(db, { archivo: 'v1.xlsx', filas: [fila('A1', 'C1', '2025-01-01'), fila('A2', 'C2', '2025-01-01'), fila('A3', 'C3', '2025-01-01')] }, actor, false);
    await repo.guardarSeguimiento(db, 'A3', { enAmbientalia: true, avisoEnviado: '2026-09-01', servicioProgramado: null, nota: 'llamar a Ana' }, actor);

    const r2 = await repo.importar(db, { archivo: 'v2.xlsx', filas: [fila('A1', 'C1', '2025-01-01'), fila('A2', 'C2', '2026-09-30')] }, actor, false);
    expect(r2).toMatchObject({ nuevos: 0, actualizados: 1, retirados: 1 });
    expect((await repo.listarEquipos(db, hoy)).map((e) => e.clave)).toEqual(['A1', 'A2']);

    // A3 vuelve en otra importación: reaparece con su seguimiento intacto.
    const r3 = await repo.importar(db, { archivo: 'v3.xlsx', filas: [fila('A1', 'C1', '2025-01-01'), fila('A2', 'C2', '2026-09-30'), fila('A3', 'C3', '2025-01-01')] }, actor, false);
    expect(r3).toMatchObject({ nuevos: 0, actualizados: 1, retirados: 0 });
    const a3 = (await repo.listarEquipos(db, hoy)).find((e) => e.clave === 'A3')!;
    expect(a3.seguimiento).toMatchObject({ enAmbientalia: true, avisoEnviado: '2026-09-01', nota: 'llamar a Ana', actualizadoPor: actor.email });
  });
});

describe('seguimiento y avisos', () => {
  beforeEach(async () => {
    await repo.importar(db, { archivo: 'x.xlsx', filas: [fila('B1', 'C', '2025-10-01'), fila('B2', 'C', '2025-10-20')] }, actor, false);
  });

  it('guardar seguimiento de un equipo inexistente es 404', async () => {
    await expect(
      repo.guardarSeguimiento(db, 'ZZ', { enAmbientalia: false, avisoEnviado: null, servicioProgramado: null, nota: '' }, actor),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('el aviso en bloque sólo pone la fecha y respeta el resto del seguimiento', async () => {
    await repo.guardarSeguimiento(db, 'B1', { enAmbientalia: false, avisoEnviado: null, servicioProgramado: '2026-11-03', nota: 'OK' }, actor);
    const n = await repo.registrarAvisos(db, ['B1', 'B2', 'NOEXISTE'], '2026-10-06', actor);
    expect(n).toBe(2);
    const eq = await repo.listarEquipos(db, hoy);
    expect(eq.find((e) => e.clave === 'B1')!.seguimiento).toMatchObject({ avisoEnviado: '2026-10-06', servicioProgramado: '2026-11-03', nota: 'OK' });
    expect(eq.find((e) => e.clave === 'B2')!.seguimiento).toMatchObject({ avisoEnviado: '2026-10-06', enAmbientalia: false, nota: '' });
  });
});
