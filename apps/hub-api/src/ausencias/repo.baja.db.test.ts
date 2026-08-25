import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
import { retirarEmpleado, reactivarEmpleado, crearSolicitud, listaDeRetirados } from './service.js';

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
      code: 'retiro_bloqueado', status: 409,
      // El detalle es obligatorio, no decorativo: sin afirmarlo, quitarlo del
      // throw deja este mismo test en verde y nadie se entera.
      //
      // La mitad vacia (`personas: []`) tambien se afirma, y no es relleno:
      // `toMatchObject` empareja por SUBCONJUNTO, asi que sin esta linea el
      // test no dice nada sobre `personas` y un `personas: undefined` en el
      // throw (en vez de `[]`) seguiria pasando. El cliente hace `.length`
      // sobre las dos listas, y un `undefined` ahi revienta la pantalla en
      // vez de no mostrar nada.
      detalle: { solicitudes: [{ fechaFin: '2026-10-09', estado: 'aprobada' }], personas: [] },
    });
  });

  it('409 si alguien lo tiene de jefe', async () => {
    await sembrarEmpleado(db, 'jefe3@baja.test');
    await sembrarEmpleado(db, 'sub3@baja.test', 'jefe3@baja.test');
    const { rows } = await db.query('SELECT id FROM portal.empleados WHERE correo = $1', ['jefe3@baja.test']);
    await expect(
      retirarEmpleado(db, (rows[0] as { id: string }).id, { fechaRetiro: '2026-09-30' }, ADMIN),
    ).rejects.toMatchObject({
      code: 'retiro_bloqueado', status: 409,
      // Nombra a `sub3` y no solo cuenta cuantos hay: si el servicio preguntara
      // `personasACargoDe` por el correo del JEFE en vez de por el del retirado,
      // este test seguiria verde por casualidad del fixture si solo mirara la
      // longitud del array.
      //
      // `solicitudes: []` es la mitad vacia, gemela de la del test de arriba:
      // sin ella el test no afirma nada sobre `solicitudes` y un `undefined`
      // ahi (en vez de `[]`) pasaria igual.
      detalle: { solicitudes: [], personas: [{ correo: 'sub3@baja.test' }] },
    });
  });

  it('CANDADO: si tiene los dos problemas, el detalle trae los dos juntos', async () => {
    // El punto central del cambio: antes esto cortocircuitaba (solo se conocia
    // el primer bloqueo que saltara). La poblacion que se topa con los dos no
    // es rara: es el jefe que se va, que tiene equipo por definicion y suele
    // tener vacaciones pendientes. Los dos remedios se ejecutan en pantallas
    // distintas -rechazar la solicitud vs. reasignar el equipo en Organigrama-,
    // asi que descubrirlos de uno en uno puede costar dias.
    const id = await sembrarEmpleado(db, 'jefe4@baja.test');
    await sembrarEmpleado(db, 'sub4@baja.test', 'jefe4@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id, correo: 'jefe4@baja.test', estado: 'aprobada',
      fechaInicio: '2026-10-05', fechaFin: '2026-10-09', segundoAprobadorCorreo: null,
    });
    await expect(retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN)).rejects.toMatchObject({
      code: 'retiro_bloqueado', status: 409,
      detalle: {
        solicitudes: [{ fechaFin: '2026-10-09' }],
        personas: [{ correo: 'sub4@baja.test' }],
      },
    });
  });

  it('CANDADO: una solicitud ANTERIOR a la fecha no impide la baja', async () => {
    // Gemelo de servicio del candado de `diasPosterioresA`: sin el, la fecha que
    // este servicio le pasa al repo puede ser cualquiera -comprobado mutandola a
    // '1900-01-01': los tests de este fichero siguen verdes- y la promesa del
    // JSDoc de que lo anterior no estorba no la vigila nadie.
    const id = await sembrarEmpleado(db, 'anterior@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id, correo: 'anterior@baja.test', estado: 'pendiente',
      fechaInicio: '2026-09-07', fechaFin: '2026-09-11', segundoAprobadorCorreo: null,
    });
    const e = await retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN);
    expect(e.fechaRetiro).toBe('2026-09-30');
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

  it('CANDADO: retirar a una ficha YA inactiva devuelve la ficha, no un 404 espurio', async () => {
    // Es el caso de las cuentas desactivadas a mano antes de que esta feature
    // existiera: tienen que poder recibir su fecha despues. Si la relectura
    // filtrara por `activo`, la baja se escribiria bien y el servicio contestaria
    // 404 igualmente. Hermano del candado de fijarRetiro en la tarea anterior.
    const id = await sembrarEmpleado(db, 'yainactiva@baja.test');
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [id]);
    const e = await retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN);
    expect(e.fechaRetiro).toBe('2026-09-30');
    expect(e.activo).toBe(false);
  });

  it('reactivarEmpleado deshace la baja', async () => {
    const id = await sembrarEmpleado(db, 'reac@baja.test');
    await retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN);
    // Cuarto dato obligatorio (AJUSTE 2): quien deshace la baja tambien queda
    // registrado, en el evento estructurado que sustituye a las columnas que
    // limpiarRetiro borra.
    //
    // Se espia console.log porque es el UNICO rastro que queda de la baja
    // deshecha (limpiarRetiro borra retirado_por/retirado_at de la fila): sin
    // este test, borrar el console.log entero de reactivarEmpleado deja la
    // suite en verde, que es justo el sintoma que el JSDoc de la funcion
    // advierte. fechaRetiroQueTenia y retiradoPor importan en particular
    // porque son EXACTAMENTE lo que la fila deja de tener, y son la razon
    // entera de que la lectura de "antes" vaya ANTES de limpiar: sin afirmar
    // estos dos campos, mover el console.log dos lineas mas abajo lo
    // convertiria en `null, null` sin que nadie se entere.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const e = await reactivarEmpleado(db, id, ADMIN);
      expect(e.fechaRetiro).toBeNull();
      expect(e.activo).toBe(true);

      // Mensaje legible si esto muere (en vez del TypeError de leer `.at(-1)`
      // de una lista vacia), y de paso ata que la reactivacion registre UNA
      // vez y no dos. Mismo patron que `audit.logger.test.ts`.
      expect(spy).toHaveBeenCalledTimes(1);
      const log = JSON.parse(spy.mock.calls.at(-1)![0] as string);
      expect(log).toMatchObject({
        event: 'ausencias_baja_deshecha',
        correo: 'reac@baja.test',
        fechaRetiroQueTenia: '2026-09-30',
        retiradoPor: ADMIN,
        deshechoPor: ADMIN,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('CANDADO: reactivarEmpleado alcanza una ficha YA inactiva (la lectura de ANTES de limpiar)', async () => {
    // Gemelo del candado de arriba, pero en la lectura que se hace ANTES de
    // `limpiarRetiro`. Es el caso real: alguien con `fecha_retiro` ya vencida,
    // a quien el barrido (`aplicarRetirosVencidos`) ya desactivo. Deshacer esa
    // baja exige poder LEER una ficha inactiva antes de limpiarla; si esa
    // lectura filtrara por `activo`, el servicio devolveria 404 justo antes de
    // poder arreglar la baja que dejo la ficha inactiva.
    //
    // La lectura de DESPUES de `limpiarRetiro` (la que arma la respuesta) no
    // necesita este candado: el UPDATE de `limpiarRetiro` deja `activo = true`
    // SIN CONDICION (no lleva `WHERE activo`), asi que un filtro `AND activo`
    // ahi encontraria la fila de todos modos. Se comprobo mutando esa segunda
    // lectura a `empleadoPorId`: ningun test de este fichero se pone rojo.
    const id = await sembrarEmpleado(db, 'yadesactivada@baja.test');
    await fijarRetiro(db, id, '2026-08-20', ADMIN);
    await aplicarRetirosVencidos(db, '2026-08-24');
    const e = await reactivarEmpleado(db, id, ADMIN);
    expect(e.activo).toBe(true);
    expect(e.fechaRetiro).toBeNull();
  });

  it('reactivarEmpleado: 404 si el empleado no existe', async () => {
    // Vigila el guard `if (!antes) throw ...` que la lectura previa al evento
    // necesita (AJUSTE 2): sin este test ese guard no lo comprueba nadie.
    await expect(
      reactivarEmpleado(db, '00000000-0000-4000-8000-000000000000', ADMIN),
    ).rejects.toMatchObject({ code: 'empleado_no_encontrado', status: 404 });
  });
});

describe('no se piden dias mas alla del retiro', () => {
  it('409 al pedir vacaciones que terminan despues de la fecha de retiro', async () => {
    const id = await sembrarEmpleado(db, 'limite@baja.test');
    await fijarRetiro(db, id, '2026-09-30', 'admin@ambientalia.com.co');
    await expect(
      crearSolicitud(db, { email: 'limite@baja.test', userId: null, esAdmin: false },
        { tipo: 'vacaciones', fechaInicio: '2026-10-05', fechaFin: '2026-10-09', comentarios: '' }),
    ).rejects.toMatchObject({ code: 'fecha_posterior_al_retiro', status: 409 });
  });

  it('CANDADO: hasta su ultimo dia SI puede pedir', async () => {
    const id = await sembrarEmpleado(db, 'hasta@baja.test');
    await fijarRetiro(db, id, '2026-09-30', 'admin@ambientalia.com.co');
    const s = await crearSolicitud(db, { email: 'hasta@baja.test', userId: null, esAdmin: false },
      { tipo: 'vacaciones', fechaInicio: '2026-09-28', fechaFin: '2026-09-30', comentarios: '' });
    expect(s.estado).toBe('pendiente');
  });

  it('CANDADO: un otorgamiento tambien queda bloqueado si su fecha cae despues del retiro', async () => {
    // Decision (tarea 9): el otorgamiento NO se exceptua de esta guarda.
    //
    // `diasPosterioresA` -la otra mitad de este mismo candado, la que bloquea
    // FIJAR el retiro cuando quedan dias por detras- tampoco lo exceptua por
    // tipo: su WHERE (repo.ts) solo mira `fecha_fin > fecha` y el estado, sin
    // `tipo <> 'otorgamiento'`. Si esta guarda lo exceptuara, las dos mitades
    // dejarian de ser simetricas: un otorgamiento posterior bloquearia fijar
    // el retiro, pero crear ese mismo otorgamiento DESPUES de fijarlo pasaria
    // libre.
    //
    // Ademas tiene sentido por si solo, sin apelar a la simetria: la fecha de
    // un otorgamiento es el dia que se TRABAJO, y reclamar uno posterior al
    // ultimo dia trabajado es la misma contradiccion que agendar una ausencia
    // despues de haberse ido -aunque uno sume dias y la otra los gaste-.
    //
    // El caso solo se da con la fecha de retiro ya en el pasado: un
    // otorgamiento nunca se puede pedir para el futuro (`trabajo_en_el_futuro`
    // en service.ts), asi que con un retiro todavia futuro esta comparacion
    // nunca da `>`. Aqui se fuerza sembrando un retiro ya vencido, antes de
    // que el barrido desactive la ficha.
    const id = await sembrarEmpleado(db, 'trabajo@baja.test');
    await fijarRetiro(db, id, '2026-08-20', 'admin@ambientalia.com.co');
    await expect(
      crearSolicitud(db, { email: 'trabajo@baja.test', userId: null, esAdmin: false }, {
        tipo: 'otorgamiento',
        fechaInicio: '2026-08-22',
        fechaFin: '2026-08-22',
        dias: 1,
        comentarios: 'trabaje este dia',
      }),
    ).rejects.toMatchObject({ code: 'fecha_posterior_al_retiro', status: 409 });
  });
});

describe('listaDeRetirados', () => {
  const ADMIN = 'admin@ambientalia.com.co';

  /** El saldo de una ficha de la lista, buscada por correo. */
  function porCorreo(lista: Awaited<ReturnType<typeof listaDeRetirados>>, correo: string) {
    const r = lista.find((x) => x.correo === correo);
    if (!r) throw new Error(`la lista no trae a ${correo}`);
    return r;
  }

  it('devuelve al retirado con su saldo CONGELADO en la fecha de retiro', async () => {
    const id = await sembrarEmpleado(db, 'liq@baja.test');
    await db.query(
      `UPDATE portal.empleados SET saldo_corte = 10, fecha_corte = '2026-01-01' WHERE id = $1`,
      [id],
    );
    // Un activo sembrado a la vez, y no solo en el test de mas abajo: con una
    // sola ficha en la tabla, una consulta SIN filtro ninguno seguiria dando
    // `toHaveLength(1)` y este candado no vigilaria nada.
    await sembrarEmpleado(db, 'sigue@baja.test');
    await fijarRetiro(db, id, '2026-03-01', ADMIN);
    await aplicarRetirosVencidos(db, '2026-08-24');

    const lista = await listaDeRetirados(db);
    expect(lista).toHaveLength(1);
    expect(lista[0].correo).toBe('liq@baja.test');
    // Enero y febrero: 59 dias / 30 x 1,25 = 2,5. Si esto trajera el devengo
    // hasta HOY serian siete meses, no dos: la congelacion no estaria llegando
    // a esta consulta y el numero que se paga en la liquidacion saldria
    // inflado. Es el motivo entero por el que esta pantalla existe.
    expect(lista[0].saldo.devengadas).toBeCloseTo(2.5, 5);
    expect(lista[0].saldo.disponible).toBeCloseTo(12.5, 5);
    expect(lista[0].fechaRetiro).toBe('2026-03-01');
    expect(lista[0].retiradoPor).toBe(ADMIN);
    expect(lista[0].retiroAntesDelCorte).toBe(false);
    expect(lista[0].solicitudesVivas).toBe(0);
  });

  it('cuenta las solicitudes vivas, que son las que todavia pueden mover el numero', async () => {
    const id = await sembrarEmpleado(db, 'viva@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'viva@baja.test',
      estado: 'pendiente',
      fechaInicio: '2026-02-02',
      fechaFin: '2026-02-04',
      segundoAprobadorCorreo: null,
    });
    // `pendiente_2` es el mismo tramite en su segundo nivel de firma: si no
    // contara, una solicitud a punto de firmarse pasaria por definitiva.
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'viva@baja.test',
      estado: 'pendiente_2',
      fechaInicio: '2026-02-09',
      fechaFin: '2026-02-11',
      segundoAprobadorCorreo: 'jefe2@ambientalia.com.co',
    });
    // Estas dos ya NO mueven el numero: la aprobada ya esta descontada y la
    // rechazada no consume nada. Sin ellas, un filtro de estados borrado
    // entero sobreviviria a este test.
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'viva@baja.test',
      estado: 'aprobada',
      fechaInicio: '2026-01-05',
      fechaFin: '2026-01-07',
      segundoAprobadorCorreo: null,
    });
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'viva@baja.test',
      estado: 'rechazada',
      fechaInicio: '2026-01-12',
      fechaFin: '2026-01-14',
      segundoAprobadorCorreo: null,
    });

    // Un SEGUNDO retirado con UNA sola pendiente. Sin el, quitar el
    // `WHERE empleado_id = ANY($1)` del recuento dejaria este test en verde:
    // con una sola ficha sembrada, el total y el suyo son el mismo numero.
    const otro = await sembrarEmpleado(db, 'otro@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: otro,
      correo: 'otro@baja.test',
      estado: 'pendiente',
      fechaInicio: '2026-02-16',
      fechaFin: '2026-02-18',
      segundoAprobadorCorreo: null,
    });

    await fijarRetiro(db, id, '2026-03-01', ADMIN);
    await fijarRetiro(db, otro, '2026-03-01', ADMIN);
    await aplicarRetirosVencidos(db, '2026-08-24');

    const lista = await listaDeRetirados(db);
    expect(porCorreo(lista, 'viva@baja.test').solicitudesVivas).toBe(2);
    expect(porCorreo(lista, 'otro@baja.test').solicitudesVivas).toBe(1);
  });

  it('avisa cuando la fecha de retiro es ANTERIOR al corte del saldo', async () => {
    const id = await sembrarEmpleado(db, 'corte@baja.test');
    await db.query(
      `UPDATE portal.empleados SET saldo_corte = 4, fecha_corte = '2026-06-01' WHERE id = $1`,
      [id],
    );
    await fijarRetiro(db, id, '2026-03-01', ADMIN);
    await aplicarRetirosVencidos(db, '2026-08-24');

    const [r] = await listaDeRetirados(db);
    expect(r.retiroAntesDelCorte).toBe(true);
    // Aritmeticamente no revienta -devenga cero-, y por eso se AVISA y no se
    // bloquea: casi siempre es un ano mal tecleado, pero puede ser legitimo.
    expect(r.saldo.devengadas).toBe(0);
  });

  it('CANDADO: una ficha desactivada a mano, sin fecha, tambien sale', async () => {
    // Son las dos cuentas de prueba del 2026-08-24. Si no salieran aqui no
    // apareceririan en NINGUNA de las dos vistas, y se quedarian sin sitio.
    const id = await sembrarEmpleado(db, 'prueba@baja.test');
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [id]);

    const lista = await listaDeRetirados(db);
    expect(lista).toHaveLength(1);
    expect(lista[0].fechaRetiro).toBeNull();
    expect(lista[0].retiradoPor).toBeNull();
  });

  it('no devuelve a nadie activo, ni siquiera con la baja ya programada', async () => {
    await sembrarEmpleado(db, 'sigue@baja.test');
    // Con fecha futura sigue trabajando: la baja programada es solo un dato
    // hasta que vence, asi que su sitio es Activos.
    const futuro = await sembrarEmpleado(db, 'futuro@baja.test');
    await fijarRetiro(db, futuro, '2026-12-31', ADMIN);

    expect(await listaDeRetirados(db)).toHaveLength(0);
  });

  it('ordena por fecha de retiro descendente, y los que no tienen van al final', async () => {
    // La vista es de liquidacion: lo ultimo que ha pasado es lo que se esta
    // pagando ahora. Los sin fecha son fichas viejas que no se liquidan.
    const viejo = await sembrarEmpleado(db, 'viejo@baja.test');
    const reciente = await sembrarEmpleado(db, 'reciente@baja.test');
    const sinFecha = await sembrarEmpleado(db, 'sinfecha@baja.test');
    await fijarRetiro(db, viejo, '2026-02-01', ADMIN);
    await fijarRetiro(db, reciente, '2026-07-01', ADMIN);
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [sinFecha]);
    await aplicarRetirosVencidos(db, '2026-08-24');

    const lista = await listaDeRetirados(db);
    expect(lista.map((r) => r.correo)).toEqual([
      'reciente@baja.test',
      'viejo@baja.test',
      'sinfecha@baja.test',
    ]);
  });
});
