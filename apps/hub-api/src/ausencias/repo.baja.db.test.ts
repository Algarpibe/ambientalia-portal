import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';

// La baja de empleados contra Postgres de verdad.
//
// Todo lo de este fichero es SQL, y en este repo una regla escrita en SQL solo
// la vigila un test de test:db: el doble in-memory de router.test.ts no ejecuta
// consultas, asi que una columna que falte o un WHERE mal puesto pasarian los
// 1013 unitarios en verde.

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
});

describe('migracion 035', () => {
  it('CANDADO: las tres columnas existen (o sea, la 035 esta en el array MIGRATIONS)', async () => {
    // Olvidar el array no da ningun error: la migracion no corre y la columna
    // no existe solo en produccion. Este test es el unico que lo caza.
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'empleados'
          AND column_name IN ('fecha_retiro', 'retirado_por', 'retirado_at')
        ORDER BY column_name`,
    );
    // Se fija el tipo entero y no solo el nombre: un `data_type` que cambiara
    // sin que este test se enterara pasaria desapercibido hasta que un WHERE
    // de una tarea futura (`fecha_retiro < $1::date`) comparara contra el tipo
    // equivocado. Mismo patron que el candado de la 034 en
    // auth.requireauth.db.test.ts, nacido del incidente SEC-220.
    expect(rows).toEqual([
      { column_name: 'fecha_retiro', data_type: 'date', is_nullable: 'YES' },
      { column_name: 'retirado_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
      { column_name: 'retirado_por', data_type: 'character varying', is_nullable: 'YES' },
    ]);
  });

  it('una ficha recien sembrada nace sin retiro', async () => {
    const id = await sembrarEmpleado(db, 'ana@baja.test');
    const { rows } = await db.query(
      'SELECT fecha_retiro, retirado_por, retirado_at FROM portal.empleados WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ fecha_retiro: null, retirado_por: null, retirado_at: null });
  });
});
