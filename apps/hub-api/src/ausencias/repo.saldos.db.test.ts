import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { fijarSaldo, empleadosConSaldo, ausenciasQueTocanElSaldo } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// Las dos bolsas contra Postgres de verdad.
//
// Hasta ahora ningun .db.test.ts tocaba el saldo, y hay tres cosas de esta
// funcion que SOLO se pueden acreditar aqui, porque el doble in-memory de
// router.test.ts no ejecuta SQL:
//
//  1. El CHECK `empleados_compensatorios_completo`. Es la migracion la que
//     impide media configuracion, no la validacion; y de paso este fichero es el
//     unico candado de que la 029 este en el array MIGRATIONS de db.ts, porque
//     olvidarla ahi no da ningun error.
//  2. El `CASE WHEN` del UPDATE, que es lo que hace que «el cliente no mando la
//     pareja» signifique «no la toques» y no «vaciala». El doble lo imita a mano,
//     asi que imitarlo mal dejaria los dos verdes a la vez.
//  3. Los casts del SELECT. Sin `::float8` un NUMERIC llega como string; sin
//     `::text` un DATE llega como objeto Date, y con eso la comparacion
//     `fechaInicio >= fechaCorte` es SIEMPRE false y no se descuenta nada, en
//     silencio. Es el gotcha por el que `calcularSaldo` lanza.

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

/** La fila cruda, sin pasar por los casts ni por el mapeo del repo. */
async function columnas(): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    `SELECT saldo_corte, fecha_corte, compensatorios_saldo_corte, compensatorios_fecha_corte
       FROM portal.empleados WHERE id = $1`,
    [empleadoId],
  );
  return rows[0] as Record<string, unknown>;
}

const VACACIONES = { saldoCorte: 10, fechaCorte: '2026-01-01' };
const COMPENSATORIOS = { saldoCorte: 4, fechaCorte: '2026-02-01' };

describe('el CHECK de la migracion 029', () => {
  it('rechaza media pareja de compensatorios', async () => {
    // Lo impide la BD y no solo la validacion, por lo mismo que en la 017: media
    // configuracion ensenaria un saldo inventado, y aqui ademas «sin configurar»
    // es el estado de partida de TODA la plantilla.
    await expect(
      db.query(`UPDATE portal.empleados SET compensatorios_saldo_corte = 4 WHERE id = $1`, [empleadoId]),
    ).rejects.toThrow();
    await expect(
      db.query(`UPDATE portal.empleados SET compensatorios_fecha_corte = '2026-02-01' WHERE id = $1`, [empleadoId]),
    ).rejects.toThrow();
  });

  it('admite las dos, y admite ninguna', async () => {
    await db.query(
      `UPDATE portal.empleados
          SET compensatorios_saldo_corte = 4, compensatorios_fecha_corte = '2026-02-01'
        WHERE id = $1`,
      [empleadoId],
    );
    expect((await columnas()).compensatorios_saldo_corte).not.toBeNull();
    await db.query(
      `UPDATE portal.empleados
          SET compensatorios_saldo_corte = NULL, compensatorios_fecha_corte = NULL
        WHERE id = $1`,
      [empleadoId],
    );
    expect((await columnas()).compensatorios_saldo_corte).toBeNull();
  });

  it('no toca el CHECK de vacaciones, que sigue exigiendo su pareja', async () => {
    // La 029 anade un constraint gemelo, no reescribe el de la 017.
    await expect(
      db.query(`UPDATE portal.empleados SET saldo_corte = 10 WHERE id = $1`, [empleadoId]),
    ).rejects.toThrow();
  });
});

describe('fijarSaldo', () => {
  it('CANDADO del despliegue: con la pareja en null, la columna se queda EXACTAMENTE como estaba', async () => {
    // El `CASE WHEN` es SQL crudo que el doble in-memory no ejecuta. Si aqui se
    // hubiera usado COALESCE, este test se pondria rojo al vaciar la bolsa a
    // proposito; si se hubiera usado el parametro a secas, se pondria rojo aqui.
    await fijarSaldo(db, empleadoId, VACACIONES, COMPENSATORIOS);
    await fijarSaldo(db, empleadoId, { saldoCorte: 99, fechaCorte: '2026-06-01' }, null);

    const fila = await columnas();
    expect(Number(fila.compensatorios_saldo_corte)).toBe(4);
    expect(Number(fila.saldo_corte)).toBe(99);
  });

  it('con la pareja presente y vacia SI vacia la bolsa', async () => {
    // La otra mitad de la distincion: null-el-objeto es «no tocar», null-los-
    // campos es «vaciar». Sin este test, «no tocar nunca» pasaria el de arriba.
    await fijarSaldo(db, empleadoId, VACACIONES, COMPENSATORIOS);
    await fijarSaldo(db, empleadoId, VACACIONES, { saldoCorte: null, fechaCorte: null });
    expect((await columnas()).compensatorios_saldo_corte).toBeNull();
  });

  it('escribe las dos parejas con fechas de corte distintas', async () => {
    // Que puedan separarse es la razon entera de que sean columnas propias.
    await fijarSaldo(db, empleadoId, VACACIONES, COMPENSATORIOS);
    const fila = await columnas();
    expect(String(fila.fecha_corte)).not.toBe(String(fila.compensatorios_fecha_corte));
  });

  it('la columna NUMERIC(5,1) redondea a la decima al escribir', async () => {
    await fijarSaldo(db, empleadoId, VACACIONES, { saldoCorte: 18.96, fechaCorte: '2026-02-01' });
    expect(Number((await columnas()).compensatorios_saldo_corte)).toBe(19);
  });

  it('el AND activo cubre tambien las columnas nuevas', async () => {
    // La escritura tiene que tapar el mismo conjunto que la lectura, o el
    // servicio creeria que fue bien algo que ninguna lectura va a ensenar nunca.
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    expect(await fijarSaldo(db, empleadoId, VACACIONES, COMPENSATORIOS)).toBe(false);
    expect((await columnas()).compensatorios_saldo_corte).toBeNull();
  });
});

describe('empleadosConSaldo', () => {
  it('CANDADO de los casts: numero y CADENA, nunca string y objeto Date', async () => {
    // Sin `::float8` el NUMERIC llega como string; sin `::text` el DATE llega
    // como Date, y entonces `fechaInicio >= fechaCorte` compara contra NaN y da
    // false para siempre: no se descontaria un solo dia, sin error ninguno.
    await fijarSaldo(db, empleadoId, VACACIONES, COMPENSATORIOS);
    // fecha_retiro entra en la misma trampa: sin `::text` llegaria como objeto
    // Date, `hoyCongelado` la compararia contra `hoy` (string) y la comparacion
    // seria siempre false — nadie se congelaria nunca, en silencio.
    await db.query(`UPDATE portal.empleados SET fecha_retiro = '2026-03-15' WHERE id = $1`, [empleadoId]);
    const [fila] = await empleadosConSaldo(db, null, empleadoId);
    expect(typeof fila.compensatoriosSaldoCorte).toBe('number');
    expect(typeof fila.compensatoriosFechaCorte).toBe('string');
    expect(fila.compensatoriosFechaCorte).toBe('2026-02-01');
    // La pareja vieja, por si alguien tocara el SELECT y solo arreglara la nueva.
    expect(typeof fila.saldoCorte).toBe('number');
    expect(typeof fila.fechaCorte).toBe('string');
    expect(typeof fila.fechaRetiro).toBe('string');
    expect(fila.fechaRetiro).toBe('2026-03-15');
  });

  it('sin configurar, las dos parejas llegan a null y no a cero', async () => {
    const [fila] = await empleadosConSaldo(db, null, empleadoId);
    expect(fila.compensatoriosSaldoCorte).toBeNull();
    expect(fila.compensatoriosFechaCorte).toBeNull();
  });
});

describe('ausenciasQueTocanElSaldo', () => {
  it('trae vacaciones y compensatorios, y descarta permisos e incapacidades', async () => {
    // El filtro de la consulta real. El doble de router.test.ts lo replica a
    // mano, asi que si el SQL se desviara del doble, este es el unico sitio
    // donde se veria.
    await sembrarSolicitud(db, {
      empleadoId, correo: CORREO, estado: 'aprobada', tipo: 'vacaciones',
      fechaInicio: '2026-03-02', fechaFin: '2026-03-06', segundoAprobadorCorreo: null,
    });
    await sembrarSolicitud(db, {
      empleadoId, correo: CORREO, estado: 'aprobada', tipo: 'compensatorio',
      fechaInicio: '2026-04-06', fechaFin: '2026-04-10', segundoAprobadorCorreo: null,
    });
    await sembrarSolicitud(db, {
      empleadoId, correo: CORREO, estado: 'aprobada', tipo: 'permiso',
      fechaInicio: '2026-05-04', fechaFin: '2026-05-08', segundoAprobadorCorreo: null,
    });
    await sembrarSolicitud(db, {
      empleadoId, correo: CORREO, estado: 'registrada', tipo: 'incapacidad',
      fechaInicio: '2026-06-01', fechaFin: '2026-06-05', segundoAprobadorCorreo: null,
    });

    const filas = await ausenciasQueTocanElSaldo(db, [empleadoId]);
    expect(filas.map((f) => f.tipo).sort()).toEqual(['compensatorio', 'vacaciones']);
  });

  it('CANDADO de los casts: fechaInicio es CADENA y diasHabiles es numero', async () => {
    await sembrarSolicitud(db, {
      empleadoId, correo: CORREO, estado: 'aprobada', tipo: 'compensatorio',
      fechaInicio: '2026-04-06', fechaFin: '2026-04-10', segundoAprobadorCorreo: null,
    });
    const [fila] = await ausenciasQueTocanElSaldo(db, [empleadoId]);
    expect(typeof fila.fechaInicio).toBe('string');
    expect(fila.fechaInicio).toBe('2026-04-06');
    expect(typeof fila.diasHabiles).toBe('number');
  });

  it('sin ids no va a la base', async () => {
    expect(await ausenciasQueTocanElSaldo(db, [])).toEqual([]);
  });
});
