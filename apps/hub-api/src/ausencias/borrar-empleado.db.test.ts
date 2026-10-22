import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// DATA-342 — la clave ajena de `solicitudes_ausencia.empleado_id` era
// `ON DELETE CASCADE`, y de la solicitud cuelgan en cascada sus adjuntos y sus
// propuestas de cambio. Un DELETE de una ficha de empleado —hoy solo posible a
// mano desde psql— se llevaba en silencio todo su histórico laboral y sus PDF
// médicos. Las bajas ya existen como `fecha_retiro`: borrar la ficha no es la
// forma de dar de baja a nadie, así que la base tiene que negarse.

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

describe('borrar una ficha de empleado (DATA-342)', () => {
  it('con solicitudes, la base se niega y no se pierde ninguna', async () => {
    const empleadoId = await sembrarEmpleado(db, 'ana.ruiz@ambientalia.com.co');
    const s = await sembrarSolicitud(db, {
      empleadoId,
      correo: 'ana.ruiz@ambientalia.com.co',
      estado: 'aprobada',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
      segundoAprobadorCorreo: null,
    });

    // 23503 = foreign_key_violation.
    await expect(db.query('DELETE FROM portal.empleados WHERE id = $1', [empleadoId])).rejects.toMatchObject({
      code: '23503',
    });
    const { rows } = await db.query('SELECT count(*)::int AS n FROM portal.solicitudes_ausencia WHERE id = $1', [
      s.id,
    ]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('sin solicitudes, se puede borrar (una ficha creada por error)', async () => {
    const empleadoId = await sembrarEmpleado(db, 'error@ambientalia.com.co');
    await expect(db.query('DELETE FROM portal.empleados WHERE id = $1', [empleadoId])).resolves.toMatchObject({
      rowCount: 1,
    });
  });
});
