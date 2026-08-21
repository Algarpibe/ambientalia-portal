import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { puedeExportarRegistro, fijarExportador } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';

// El permiso de exportar el registro general (migracion 031), contra Postgres
// de verdad.
//
// El doble en memoria de router.test.ts modela la SUPERFICIE de estas dos
// funciones (el candado de ese fichero lo exige), pero no puede acreditar lo
// que solo el motor real demuestra:
//  1. Que el UPDATE y el INSERT del log van en la MISMA transaccion, tal como
//     hace `fijarVisorConRegistro` para el visor de adjuntos.
//  2. El `AND activo` de las dos consultas, ejecutado por Postgres y no
//     reimplementado a mano con un `.find()`.
//  3. Que el log es HISTORIAL: conceder y quitar dejan DOS filas, no una que
//     se pisa a si misma.

const ADMIN = 'gerencia@ambientalia.com.co';
const CORREO = 'ana.ruiz@ambientalia.com.co';

let db: Pool;
let empleadoId: string;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
  empleadoId = await sembrarEmpleado(db, CORREO);
});

/** Las filas del log, en el orden en que se escribieron. */
async function log(): Promise<Record<string, unknown>[]> {
  const { rows } = await db.query(
    `SELECT admin_email, empleado_id, empleado_correo, concedido
       FROM portal.exportadores_registro_log ORDER BY id`,
  );
  return rows as Record<string, unknown>[];
}

describe('fijarExportador', () => {
  it('concede el permiso: la ficha queda en true y el log gana una fila', async () => {
    expect(await fijarExportador(db, ADMIN, empleadoId, true)).toBe(true);
    expect(await puedeExportarRegistro(db, CORREO)).toBe(true);

    const filas = await log();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      admin_email: ADMIN,
      empleado_id: empleadoId,
      empleado_correo: CORREO,
      concedido: true,
    });
  });

  it('quitarlo deja la ficha en false y escribe OTRA fila, no pisa la anterior', async () => {
    // El log es un historial, no un espejo del estado actual: conceder y
    // quitar tienen que dejar DOS filas, con las dos lecturas distintas.
    await fijarExportador(db, ADMIN, empleadoId, true);
    expect(await fijarExportador(db, ADMIN, empleadoId, false)).toBe(true);
    expect(await puedeExportarRegistro(db, CORREO)).toBe(false);

    const filas = await log();
    expect(filas).toHaveLength(2);
    expect(filas[0].concedido).toBe(true);
    expect(filas[1]).toMatchObject({ concedido: false, empleado_correo: CORREO });
  });

  it('un id inexistente no toca nada: false, y ni una fila en el log', async () => {
    const fantasma = '00000000-0000-4000-8000-000000000000';
    expect(await fijarExportador(db, ADMIN, fantasma, true)).toBe(false);
    expect(await log()).toHaveLength(0);
  });

  it('una ficha inactiva tampoco: false, y el intento no ensucia el log', async () => {
    // El `AND activo` cubre la ESCRITURA con el mismo criterio que la
    // lectura de `puedeExportarRegistro` (ver el otro describe): un ex
    // empleado no puede acabar con el permiso encendido porque alguien
    // reutilizo su id sin fijarse en que ya estaba desactivado.
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    expect(await fijarExportador(db, ADMIN, empleadoId, true)).toBe(false);
    expect(await log()).toHaveLength(0);
  });
});

describe('puedeExportarRegistro', () => {
  it('false para quien no tiene el permiso marcado', async () => {
    expect(await puedeExportarRegistro(db, CORREO)).toBe(false);
  });

  it('false para una ficha inactiva, aunque tenga el permiso marcado', async () => {
    // Se concede MIENTRAS esta activa (si se desactivara antes, el `AND
    // activo` del UPDATE lo impediria y este test no probaria la lectura,
    // sino la escritura de arriba). La desactivacion llega despues, por SQL
    // directo, para dejar en la fila justo la combinacion que importa:
    // exporta_registro = true Y activo = false.
    await fijarExportador(db, ADMIN, empleadoId, true);
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    expect(await puedeExportarRegistro(db, CORREO)).toBe(false);
  });
});
