import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';
import { empleadoPorId, aplicarRetirosVencidos, diasPosterioresA, personasACargoDe } from './repo.js';

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
