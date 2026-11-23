import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar } from '../test-db/harness.js';

// La incapacidad que registra el administrador a nombre de otro, contra
// Postgres de verdad: la columna de la 080, su escritura y su lectura en el
// repo, y las dos puertas del alta (la del empleado y la del admin).

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

describe('migracion 080', () => {
  it('CANDADO: la columna registrada_por existe y admite NULL (o sea, la 080 esta en MIGRATIONS)', async () => {
    // Los casts no son estilo: las columnas de information_schema son dominios,
    // y el driver devuelve como texto lo que no reconoce.
    const { rows } = await db.query(
      `SELECT data_type::text AS tipo, character_maximum_length::int AS largo, is_nullable::text AS nulable,
              column_default::text AS por_defecto
         FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'solicitudes_ausencia' AND column_name = 'registrada_por'`,
    );
    // Sin valor por defecto: con uno, toda solicitud que registra la propia persona
    // pareceria registrada por un administrador.
    expect(rows).toEqual([{ tipo: 'character varying', largo: 254, nulable: 'YES', por_defecto: null }]);
  });
});
