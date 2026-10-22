import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from './test-db/harness.js';

// DATA-343 — el código compara los correos SIEMPRE en minúsculas
// (`lower(correo) = lower($1)`), y los índices que había eran de la columna tal
// cual: un índice sobre `correo` no sirve para buscar por `lower(correo)`, así
// que todas esas consultas recorrían la tabla entera. Con decenas de empleados no
// se nota; con `solicitudes_ausencia` creciendo cada mes, sí.
//
// Con tablas tan pequeñas como las de los tests el planificador elige un barrido
// aunque el índice exista, porque le sale más barato. `enable_seqscan = off` le
// quita esa opción: si aun así no usa el índice esperado, es que el índice no
// sirve para esa consulta, que es justo lo que se quiere vigilar.

let db: Pool;
beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});

/** Los nombres de índice que aparecen en el plan de `sql`. */
async function indicesDelPlan(sql: string, params: unknown[]): Promise<string[]> {
  const client = await db.connect();
  try {
    await client.query('SET enable_seqscan = off');
    const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
    const plan = JSON.stringify((rows[0] as Record<string, unknown>)['QUERY PLAN']);
    return [...plan.matchAll(/"Index Name":"([^"]+)"/g)].map((m) => m[1]);
  } finally {
    await client.query('RESET enable_seqscan');
    client.release();
  }
}

const CORREO = 'Ana.Ruiz@Ambientalia.com.co';

describe('índices en minúsculas para las búsquedas por correo (DATA-343)', () => {
  it('empleados por su correo (permisos, ficha propia)', async () => {
    expect(
      await indicesDelPlan(
        'SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND ve_adjuntos',
        [CORREO],
      ),
    ).toContain('idx_empleados_correo_lower');
  });

  it('empleados por su jefe (equipo de un aprobador)', async () => {
    expect(
      await indicesDelPlan('SELECT 1 FROM portal.empleados WHERE activo AND lower(aprobador_correo) = lower($1)', [
        CORREO,
      ]),
    ).toContain('idx_empleados_aprobador_lower');
  });

  // Las bandejas de pendientes NO necesitan índice en minúsculas: el parcial por
  // estado ya las deja en lo pendiente (ver la 066). Esto vigila que lo sigan
  // usando, para que un cambio en esas consultas no las devuelva a recorrer la
  // tabla entera sin que nadie se entere.
  it('las bandejas de pendientes siguen usando su índice parcial por estado', async () => {
    expect(
      await indicesDelPlan(
        `SELECT id FROM portal.solicitudes_ausencia s
          WHERE s.estado = 'pendiente' AND lower(s.aprobador_correo) = lower($1)`,
        [CORREO],
      ),
    ).toContain('idx_solicitudes_aprobador');
    expect(
      await indicesDelPlan(
        `SELECT id FROM portal.solicitudes_ausencia s
          WHERE s.estado = 'pendiente_2' AND lower(s.segundo_aprobador_correo) = lower($1)`,
        [CORREO],
      ),
    ).toContain('idx_solicitudes_segundo_aprobador');
    expect(
      await indicesDelPlan(
        `SELECT id FROM portal.solicitud_modificaciones m
          WHERE m.estado = 'pendiente' AND lower(m.aprobador_correo) = lower($1)`,
        [CORREO],
      ),
    ).toContain('idx_modificaciones_aprobador');
  });

  it('usuarios del portal por su correo', async () => {
    expect(
      await indicesDelPlan('SELECT id FROM portal.users u WHERE lower(u.email) = lower($1)', [CORREO]),
    ).toContain('idx_users_email_lower');
  });
});
