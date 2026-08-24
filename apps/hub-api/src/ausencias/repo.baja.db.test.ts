import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';
import {
  empleadoPorId,
  aplicarRetirosVencidos,
  diasPosterioresA,
  personasACargoDe,
  fijarRetiro,
  limpiarRetiro,
} from './repo.js';
import { retirarEmpleado, reactivarEmpleado } from './service.js';

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

describe('el repo lee la fecha de retiro', () => {
  it('CANDADO: devuelve fechaRetiro, retiradoPor y retiradoAt como strings, no como Date', async () => {
    const id = await sembrarEmpleado(db, 'ana@baja.test');
    await db.query(
      `UPDATE portal.empleados
          SET fecha_retiro = '2026-09-30', retirado_por = 'admin@ambientalia.com.co',
              retirado_at = NOW()
        WHERE id = $1`,
      [id],
    );
    const e = await empleadoPorId(db, id);
    // ::text en la consulta: sin el, un DATE llega como objeto Date y cualquier
    // comparacion lexicografica contra 'YYYY-MM-DD' falla EN SILENCIO.
    expect(e?.fechaRetiro).toBe('2026-09-30');
    expect(e?.retiradoPor).toBe('admin@ambientalia.com.co');
    expect(typeof e?.retiradoAt).toBe('string');
  });
});

describe('aplicarRetirosVencidos', () => {
  async function fechaRetiroDe(id: string, fecha: string): Promise<void> {
    await db.query('UPDATE portal.empleados SET fecha_retiro = $2 WHERE id = $1', [id, fecha]);
  }
  async function sigueActivo(id: string): Promise<boolean> {
    const { rows } = await db.query('SELECT activo FROM portal.empleados WHERE id = $1', [id]);
    return (rows[0] as { activo: boolean }).activo;
  }

  it('desactiva a quien tiene la fecha ya pasada', async () => {
    const id = await sembrarEmpleado(db, 'ida@baja.test');
    await fechaRetiroDe(id, '2026-08-20');
    const cuantos = await aplicarRetirosVencidos(db, '2026-08-24');
    expect(cuantos).toBe(1);
    expect(await sigueActivo(id)).toBe(false);
  });

  it('CANDADO: el DIA del retiro sigue activo, que es su ultimo dia de trabajo', async () => {
    // Con `<=` en vez de `<` este test muere. Es el gemelo del candado de
    // hoyCongelado, y el motivo por el que los dos existen: la fecha es el
    // ultimo dia TRABAJADO.
    const id = await sembrarEmpleado(db, 'hoy@baja.test');
    await fechaRetiroDe(id, '2026-08-24');
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(0);
    expect(await sigueActivo(id)).toBe(true);
  });

  it('no toca a quien tiene la fecha en el futuro', async () => {
    const id = await sembrarEmpleado(db, 'futuro@baja.test');
    await fechaRetiroDe(id, '2026-12-31');
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(0);
    expect(await sigueActivo(id)).toBe(true);
  });

  it('no toca a quien no tiene fecha', async () => {
    const id = await sembrarEmpleado(db, 'normal@baja.test');
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(0);
    expect(await sigueActivo(id)).toBe(true);
  });

  it('es idempotente: la segunda pasada no encuentra nada', async () => {
    const id = await sembrarEmpleado(db, 'dos@baja.test');
    await fechaRetiroDe(id, '2026-08-20');
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(1);
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(0);
    expect(await sigueActivo(id)).toBe(false);
  });
});

describe('diasPosterioresA', () => {
  it('encuentra las vacaciones vivas o aprobadas que pasan de la fecha', async () => {
    const id = await sembrarEmpleado(db, 'pos@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id, correo: 'pos@baja.test', estado: 'aprobada',
      fechaInicio: '2026-10-05', fechaFin: '2026-10-09', segundoAprobadorCorreo: null,
    });
    const chocan = await diasPosterioresA(db, id, '2026-09-30');
    expect(chocan).toHaveLength(1);
    expect(chocan[0].fechaFin).toBe('2026-10-09');
  });

  it('CANDADO: lo ANTERIOR a la fecha no estorba', async () => {
    // Es legitimo y corriente: quien se va el 30 de septiembre puede tener
    // vacaciones pendientes de firma para la semana que viene.
    const id = await sembrarEmpleado(db, 'ant@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id, correo: 'ant@baja.test', estado: 'pendiente',
      fechaInicio: '2026-09-07', fechaFin: '2026-09-11', segundoAprobadorCorreo: null,
    });
    expect(await diasPosterioresA(db, id, '2026-09-30')).toHaveLength(0);
  });

  it('CANDADO: una rechazada posterior tampoco estorba', async () => {
    // Solo cuentan las que consumen dias. Bloquear por una rechazada obligaria
    // a limpiar historia para poder dar de baja a alguien.
    const id = await sembrarEmpleado(db, 'rech@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id, correo: 'rech@baja.test', estado: 'rechazada',
      fechaInicio: '2026-10-05', fechaFin: '2026-10-09', segundoAprobadorCorreo: null,
    });
    expect(await diasPosterioresA(db, id, '2026-09-30')).toHaveLength(0);
  });

  it('el dia exacto de la fecha NO estorba: es su ultimo dia', async () => {
    const id = await sembrarEmpleado(db, 'exacto@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id, correo: 'exacto@baja.test', estado: 'aprobada',
      fechaInicio: '2026-09-28', fechaFin: '2026-09-30', segundoAprobadorCorreo: null,
    });
    expect(await diasPosterioresA(db, id, '2026-09-30')).toHaveLength(0);
  });

  it('CANDADO: solo mira las solicitudes de ESE empleado', async () => {
    // Cada test de este fichero limpia la tabla y siembra un solo empleado, asi
    // que sin este candado un WHERE que perdiera el filtro por empleado seguiria
    // en verde: da igual de quien sea la unica fila que hay. Con dos empleados a
    // la vez, la fila de B no puede colarse en la respuesta de A.
    const idA = await sembrarEmpleado(db, 'a@baja.test');
    const idB = await sembrarEmpleado(db, 'b@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: idB, correo: 'b@baja.test', estado: 'aprobada',
      fechaInicio: '2026-10-05', fechaFin: '2026-10-09', segundoAprobadorCorreo: null,
    });
    expect(await diasPosterioresA(db, idA, '2026-09-30')).toHaveLength(0);
  });
});

describe('personasACargoDe', () => {
  it('encuentra a quien lo tiene de jefe', async () => {
    await sembrarEmpleado(db, 'jefe@baja.test');
    await sembrarEmpleado(db, 'subordinado@baja.test', 'jefe@baja.test');
    const gente = await personasACargoDe(db, 'jefe@baja.test');
    expect(gente).toEqual([{ nombre: 'Ana Ruiz', correo: 'subordinado@baja.test' }]);
  });

  it('encuentra a quien lo tiene en copia', async () => {
    await sembrarEmpleado(db, 'copia@baja.test');
    const otro = await sembrarEmpleado(db, 'otro@baja.test');
    await db.query('UPDATE portal.empleados SET copia_correo = $2 WHERE id = $1', [otro, 'copia@baja.test']);
    expect(await personasACargoDe(db, 'copia@baja.test')).toEqual([{ nombre: 'Ana Ruiz', correo: 'otro@baja.test' }]);
  });

  it('CANDADO: una ficha ya inactiva no cuenta', async () => {
    // Si contara, no se podria dar de baja a un jefe cuyo equipo ya se fue.
    await sembrarEmpleado(db, 'jefe2@baja.test');
    const sub = await sembrarEmpleado(db, 'exsub@baja.test', 'jefe2@baja.test');
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [sub]);
    expect(await personasACargoDe(db, 'jefe2@baja.test')).toEqual([]);
  });
});

describe('fijarRetiro / limpiarRetiro', () => {
  it('guarda la fecha y la constancia, sin desactivar todavia', async () => {
    const id = await sembrarEmpleado(db, 'fijar@baja.test');
    // Correo con mayusculas: si alguien quita el `.toLowerCase()` de
    // `fijarRetiro`, este test caza que `retirado_por` quede escrito tal cual
    // llego en vez de normalizado, que es lo que rompe la comparacion de abajo.
    expect(await fijarRetiro(db, id, '2026-12-31', 'Admin@Ambientalia.com.co')).toBe(true);
    const { rows } = await db.query(
      `SELECT fecha_retiro::text AS fecha_retiro, retirado_por, retirado_at, activo
         FROM portal.empleados WHERE id = $1`,
      [id],
    );
    expect(rows[0].fecha_retiro).toBe('2026-12-31');
    expect(rows[0].retirado_por).toBe('admin@ambientalia.com.co');
    expect(rows[0].retirado_at).not.toBeNull();
    // Fecha futura: sigue trabajando. Lo apaga el barrido cuando venza.
    expect(rows[0].activo).toBe(true);
  });

  it('limpiarRetiro deshace la baja y reactiva', async () => {
    const id = await sembrarEmpleado(db, 'volver@baja.test');
    await fijarRetiro(db, id, '2026-08-20', 'admin@ambientalia.com.co');
    await aplicarRetirosVencidos(db, '2026-08-24');
    expect(await limpiarRetiro(db, id)).toBe(true);
    const { rows } = await db.query(
      `SELECT fecha_retiro, retirado_por, retirado_at, activo
         FROM portal.empleados WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      fecha_retiro: null, retirado_por: null, retirado_at: null, activo: true,
    });
  });

  it('CANDADO: fijarRetiro SI alcanza a una ficha ya inactiva', async () => {
    // Al reves que fijarSaldo y fijarJefe, que llevan `AND activo`. Aqui seria
    // un error: una ficha desactivada a mano —las cuentas de prueba— tiene que
    // poder recibir su fecha despues. Sin esto quedarian sin via de arreglo.
    const id = await sembrarEmpleado(db, 'inactiva@baja.test');
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [id]);
    expect(await fijarRetiro(db, id, '2026-08-20', 'admin@ambientalia.com.co')).toBe(true);
  });

  it('devuelve false si el empleado no existe', async () => {
    const inventado = '00000000-0000-4000-8000-000000000000';
    expect(await fijarRetiro(db, inventado, '2026-08-20', 'admin@ambientalia.com.co')).toBe(false);
    expect(await limpiarRetiro(db, inventado)).toBe(false);
  });

  it('CANDADO: fijarRetiro y limpiarRetiro tocan SOLO a ese empleado', async () => {
    // Cada test de arriba siembra una sola fila, asi que un WHERE que perdiera
    // el filtro por id seguiria en verde igual: con una sola fila en la tabla
    // da lo mismo que el UPDATE filtre o no. Con dos empleados a la vez, la
    // fila de B tiene que quedar intacta pase lo que pase con la de A. Mismo
    // patron que el candado gemelo de `diasPosterioresA` y `personasACargoDe`.
    const idA = await sembrarEmpleado(db, 'a-baja@baja.test');
    const idB = await sembrarEmpleado(db, 'b-intacto@baja.test');

    await fijarRetiro(db, idA, '2026-12-31', 'admin@ambientalia.com.co');
    const { rows: trasFijar } = await db.query(
      'SELECT fecha_retiro, retirado_por FROM portal.empleados WHERE id = $1', [idB],
    );
    expect(trasFijar[0]).toEqual({ fecha_retiro: null, retirado_por: null });

    await fijarRetiro(db, idB, '2026-11-30', 'admin@ambientalia.com.co');
    await limpiarRetiro(db, idA);
    const { rows: trasLimpiar } = await db.query(
      'SELECT fecha_retiro::text AS fecha_retiro FROM portal.empleados WHERE id = $1', [idB],
    );
    expect(trasLimpiar[0].fecha_retiro).toBe('2026-11-30');
  });
});

describe('retirarEmpleado', () => {
  const ADMIN = 'admin@ambientalia.com.co';

  it('registra la baja cuando no hay nada que estorbe', async () => {
    const id = await sembrarEmpleado(db, 'ok@baja.test');
    const e = await retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN);
    expect(e.fechaRetiro).toBe('2026-09-30');
    expect(e.retiradoPor).toBe(ADMIN);
  });

  it('409 si tiene dias posteriores a la fecha', async () => {
    const id = await sembrarEmpleado(db, 'choca@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id, correo: 'choca@baja.test', estado: 'aprobada',
      fechaInicio: '2026-10-05', fechaFin: '2026-10-09', segundoAprobadorCorreo: null,
    });
    await expect(retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN)).rejects.toMatchObject({
      code: 'retiro_con_dias_posteriores', status: 409,
    });
  });

  it('409 si alguien lo tiene de jefe', async () => {
    await sembrarEmpleado(db, 'jefe3@baja.test');
    await sembrarEmpleado(db, 'sub3@baja.test', 'jefe3@baja.test');
    const { rows } = await db.query('SELECT id FROM portal.empleados WHERE correo = $1', ['jefe3@baja.test']);
    await expect(
      retirarEmpleado(db, (rows[0] as { id: string }).id, { fechaRetiro: '2026-09-30' }, ADMIN),
    ).rejects.toMatchObject({ code: 'retiro_con_personas_a_cargo', status: 409 });
  });

  it('400 si la fecha no es una fecha', async () => {
    const id = await sembrarEmpleado(db, 'malafecha@baja.test');
    await expect(retirarEmpleado(db, id, { fechaRetiro: '30/09/2026' }, ADMIN)).rejects.toMatchObject({
      code: 'fecha_retiro_invalida', status: 400,
    });
  });

  it('404 si el empleado no existe', async () => {
    await expect(
      retirarEmpleado(db, '00000000-0000-4000-8000-000000000000', { fechaRetiro: '2026-09-30' }, ADMIN),
    ).rejects.toMatchObject({ code: 'empleado_no_encontrado', status: 404 });
  });

  it('reactivarEmpleado deshace la baja', async () => {
    const id = await sembrarEmpleado(db, 'reac@baja.test');
    await retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN);
    // Cuarto dato obligatorio (AJUSTE 2): quien deshace la baja tambien queda
    // registrado, en el evento estructurado que sustituye a las columnas que
    // limpiarRetiro borra.
    const e = await reactivarEmpleado(db, id, ADMIN);
    expect(e.fechaRetiro).toBeNull();
    expect(e.activo).toBe(true);
  });
});
