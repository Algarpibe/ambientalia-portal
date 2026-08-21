import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { esVisorDeTodaLaEmpresa, fijarVisorDeEmpresa, empleadoPorId } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';

// El permiso de ver el calendario y el registro de TODA la empresa sin ser
// administrador (migracion 032), contra Postgres de verdad.
//
// Copia la estructura de `repo.exportadores.db.test.ts` porque el permiso es su
// gemelo, y por lo mismo: el doble en memoria de router.test.ts modela la
// SUPERFICIE de estas dos funciones (el candado de ese fichero lo exige), pero
// no puede acreditar lo que solo el motor real demuestra:
//  1. Que el UPDATE y el INSERT del log van en la MISMA transaccion.
//  2. El `AND activo` de las dos consultas, ejecutado por Postgres y no
//     reimplementado a mano con un `.find()`.
//  3. Que el log es HISTORIAL: conceder y quitar dejan DOS filas, no una que
//     se pisa a si misma.
//
// El punto 2 es el que aqui pesa mas que en el gemelo, y esta es la diferencia
// que justifica el fichero: `esVisorDeAdjuntos` tiene su `AND activo` SIN
// cobertura de BD -lo dice el aviso del doble en router.test.ts-, y lo que se
// escapa por ese hueco es un ex empleado leyendo. Aqui no se repite.

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
       FROM portal.visores_empresa_log ORDER BY id`,
  );
  return rows as Record<string, unknown>[];
}

describe('fijarVisorDeEmpresa', () => {
  it('concede el permiso: la ficha queda en true y el log gana una fila', async () => {
    expect(await fijarVisorDeEmpresa(db, ADMIN, empleadoId, true)).toBe(true);
    expect(await esVisorDeTodaLaEmpresa(db, CORREO)).toBe(true);

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
    // El log es un historial, no un espejo del estado actual: reconstruir quien
    // veia la compania entera el dia que se filtro algo exige las dos lecturas.
    await fijarVisorDeEmpresa(db, ADMIN, empleadoId, true);
    expect(await fijarVisorDeEmpresa(db, ADMIN, empleadoId, false)).toBe(true);
    expect(await esVisorDeTodaLaEmpresa(db, CORREO)).toBe(false);

    const filas = await log();
    expect(filas).toHaveLength(2);
    expect(filas[0].concedido).toBe(true);
    expect(filas[1]).toMatchObject({ concedido: false, empleado_correo: CORREO });
  });

  it('un id inexistente no toca nada: false, y ni una fila en el log', async () => {
    const fantasma = '00000000-0000-4000-8000-000000000000';
    expect(await fijarVisorDeEmpresa(db, ADMIN, fantasma, true)).toBe(false);
    expect(await log()).toHaveLength(0);
  });

  it('una ficha inactiva tampoco: false, y el intento no ensucia el log', async () => {
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    expect(await fijarVisorDeEmpresa(db, ADMIN, empleadoId, true)).toBe(false);
    expect(await log()).toHaveLength(0);
  });
});

describe('esVisorDeTodaLaEmpresa', () => {
  it('false para quien no tiene el permiso marcado', async () => {
    expect(await esVisorDeTodaLaEmpresa(db, CORREO)).toBe(false);
  });

  it('CANDADO: un ex-empleado con el permiso puesto ya no ve nada', async () => {
    // El `AND activo` de la LECTURA. Se concede mientras la ficha esta activa
    // -si se desactivara antes, el `AND activo` del UPDATE lo impediria y este
    // test estaria probando la escritura de arriba, no esto-, y la baja llega
    // despues por SQL directo para dejar en la fila justo la combinacion que
    // importa: ve_toda_la_empresa = true Y activo = false.
    //
    // Sin este candado, quitar el `AND activo` de la consulta dejaria los
    // catorce ficheros de BD en verde y a alguien que ya no trabaja aqui
    // abriendo el registro con los motivos de las incapacidades de la plantilla.
    await fijarVisorDeEmpresa(db, ADMIN, empleadoId, true);
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    expect(await esVisorDeTodaLaEmpresa(db, CORREO)).toBe(false);
  });

  it('el correo se compara sin distinguir mayusculas, como el resto de la app', async () => {
    // Los correos entran por el `sub` del JWT y por la hoja de Google, y ninguno
    // de los dos garantiza la caja. La consulta lleva `lower()` a los dos lados;
    // esto lo fija.
    await fijarVisorDeEmpresa(db, ADMIN, empleadoId, true);
    expect(await esVisorDeTodaLaEmpresa(db, CORREO.toUpperCase())).toBe(true);
  });

  it('false para un correo que no es de nadie', async () => {
    expect(await esVisorDeTodaLaEmpresa(db, 'nadie@ambientalia.com.co')).toBe(false);
  });
});

describe('empleadoPorId: veTodaLaEmpresa viaja en la ficha', () => {
  // Candado del cableado de `COLS_EMPLEADO` / `aEmpleado()`, igual que en el
  // gemelo: la pestana Organigrama no puede pintar la casilla si la ficha que
  // lee el repo no trae el campo, aunque la columna SQL exista y
  // `esVisorDeTodaLaEmpresa` (arriba) la lea bien. Por eso el escritor real es
  // `fijarVisorDeEmpresa` y el lector real es `empleadoPorId`, y no un SELECT a
  // pelo: se prueba el camino que recorre la ficha entera, no la columna suelta.
  it('trae veTodaLaEmpresa en true justo despues de concederlo', async () => {
    await fijarVisorDeEmpresa(db, ADMIN, empleadoId, true);
    const ficha = await empleadoPorId(db, empleadoId);
    expect(ficha?.veTodaLaEmpresa).toBe(true);
  });

  it('trae veTodaLaEmpresa en false justo despues de quitarlo', async () => {
    await fijarVisorDeEmpresa(db, ADMIN, empleadoId, true);
    await fijarVisorDeEmpresa(db, ADMIN, empleadoId, false);
    const ficha = await empleadoPorId(db, empleadoId);
    expect(ficha?.veTodaLaEmpresa).toBe(false);
  });

  it('CANDADO: conceder este permiso no toca las otras dos llaves de la fila', async () => {
    // Las tres viven en la misma fila de `portal.empleados`. Un UPDATE que se
    // llevara por delante `ve_adjuntos` daria los PDF medicos a quien solo pidio
    // el calendario, o -al reves- se los quitaria a administracion sin que nadie
    // se enterara hasta el dia que hiciera falta abrir uno. El de router.test.ts
    // dice lo mismo contra el doble; este lo ejecuta contra el UPDATE real, que
    // es donde el fallo estaria.
    await db.query(
      `UPDATE portal.empleados SET ve_adjuntos = TRUE, exporta_registro = TRUE WHERE id = $1`,
      [empleadoId],
    );
    await fijarVisorDeEmpresa(db, ADMIN, empleadoId, true);
    const ficha = await empleadoPorId(db, empleadoId);
    expect(ficha?.veAdjuntos).toBe(true);
    expect(ficha?.exportaRegistro).toBe(true);
    expect(ficha?.veTodaLaEmpresa).toBe(true);
  });
});
