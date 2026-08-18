import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { aplicarMigraciones } from './db.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from './test-db/harness.js';

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await limpiar(db);
});

describe('las migraciones contra una base de verdad', () => {
  it('se re-ejecutan sobre una base ya migrada sin romper nada', async () => {
    // `initDb()` las lanza en CADA arranque, y no captura: si una revienta,
    // hub-api no arranca y cae el portal entero. El contenedor ya las aplico
    // una vez en el globalSetup, asi que esto es la segunda pasada.
    await expect(aplicarMigraciones(db)).resolves.toBeUndefined();
  });

  it('CANDADO: los tres eventos de modificacion pasan el CHECK Y caben en la columna', async () => {
    // El 22001 del 2026-08-17: la 024 amplio el CHECK de `evento` y dejo la
    // columna en VARCHAR(20); los tres nombres nuevos miden 21-23 y reventaban
    // en la primera peticion real. Son DOS restricciones distintas y hay que
    // mirar las dos. Lo arreglo la 025.
    const empleadoId = await sembrarEmpleado(db, 'ana.ruiz@ambientalia.com.co');
    const s = await sembrarSolicitud(db, {
      empleadoId,
      correo: 'ana.ruiz@ambientalia.com.co',
      estado: 'aprobada',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
      segundoAprobadorCorreo: null,
    });

    for (const evento of ['modificacion_solicitada', 'modificacion_aprobada', 'modificacion_rechazada']) {
      await db.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [s.id, evento, '{}'],
      );
    }

    expect(await eventosDelOutbox(db)).toEqual([
      'modificacion_solicitada',
      'modificacion_aprobada',
      'modificacion_rechazada',
    ]);
  });
});
