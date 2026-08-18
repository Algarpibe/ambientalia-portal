import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { aplicarMigraciones } from './db.js';
import { EVENTOS } from './ausencias/types.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from './test-db/harness.js';

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  // Con `?`: si `beforeAll` revienta, `db` se queda sin asignar y el TypeError
  // de este cierre taparia en el informe el error que de verdad importa.
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
});

describe('las migraciones contra una base de verdad', () => {
  it('se re-ejecutan sobre una base ya migrada Y CON DATOS sin romper nada', async () => {
    // `initDb()` las lanza en CADA arranque, y no captura: si una revienta,
    // hub-api no arranca y cae el portal entero. El contenedor ya las aplico
    // una vez en el globalSetup, asi que esto es la segunda pasada.
    //
    // La segunda pasada va sobre una base CON FILAS, que es como re-arranca
    // produccion. Sobre una base vacia pasan sin ruido justo las migraciones
    // que tumban un arranque real: un ADD COLUMN NOT NULL sin default, un CHECK
    // que las filas ya existentes violan, o un DROP+CREATE que se lleva los
    // datos por delante.
    const empleadoId = await sembrarEmpleado(db, 'ana.ruiz@ambientalia.com.co');
    const s = await sembrarSolicitud(db, {
      empleadoId,
      correo: 'ana.ruiz@ambientalia.com.co',
      estado: 'aprobada',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
      segundoAprobadorCorreo: null,
    });
    await db.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, 'creada', '{}'::jsonb)`,
      [s.id],
    );

    await expect(aplicarMigraciones(db)).resolves.toBeUndefined();

    // Que no reviente no basta: los datos tienen que seguir ahi.
    const { rows } = await db.query(
      `SELECT (SELECT count(*) FROM portal.empleados            WHERE id = $1)::int AS empleados,
              (SELECT count(*) FROM portal.solicitudes_ausencia WHERE id = $2)::int AS solicitudes`,
      [empleadoId, s.id],
    );
    expect(rows[0]).toEqual({ empleados: 1, solicitudes: 1 });
    expect(await eventosDelOutbox(db)).toEqual(['creada']);
  });

  it('CANDADO: todos los eventos del outbox pasan el CHECK Y caben en la columna', async () => {
    // El 22001 del 2026-08-17: la 024 amplio el CHECK de `evento` y dejo la
    // columna en VARCHAR(20); los tres nombres de modificacion miden 21-23 y
    // reventaban en la primera peticion real. Son DOS restricciones distintas
    // y hay que mirar las dos. Lo arreglo la 025.
    //
    // Recorre `EVENTOS` —la lista que usa el codigo— y no tres literales
    // copiados: con literales, renombrar un evento a uno mas largo (un
    // `modificacion_solicitada_por_el_trabajador` mide 41 y no cabe en el
    // VARCHAR(40)) o anadir el decimo dejaria este test verde y repetiria el
    // 2026-08-17 tal cual.
    const empleadoId = await sembrarEmpleado(db, 'ana.ruiz@ambientalia.com.co');
    const s = await sembrarSolicitud(db, {
      empleadoId,
      correo: 'ana.ruiz@ambientalia.com.co',
      estado: 'aprobada',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
      segundoAprobadorCorreo: null,
    });

    for (const evento of EVENTOS) {
      await db.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [s.id, evento, '{}'],
      );
    }

    expect(await eventosDelOutbox(db)).toEqual([...EVENTOS]);
  });
});
