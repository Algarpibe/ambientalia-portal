import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { esVisorDeKpis, fijarVisorDeKpis, empleadoPorId } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';

// La llave del panel de KPIs (migracion 038), contra Postgres de verdad.
//
// Copia la estructura de `repo.visor-empresa.db.test.ts` porque el permiso es
// su hermano, y por lo mismo:
//  1. Que el UPDATE y el INSERT del log van en la MISMA transaccion.
//  2. El `AND activo` de las dos consultas, ejecutado por Postgres.
//  3. Que el log es HISTORIAL: conceder y quitar dejan DOS filas.
//
// El rol de administrador tambien abre el panel, plegado en el router igual que
// en las otras tres llaves. Eso NO se prueba aqui y no puede: el repo solo ve
// `portal.empleados` y no sabe nada de `portal.users`. Lo fijan los tests de
// «esVisorDeKpis: el rol de admin, o la llave ficha a ficha» en router.test.ts.
//
// Lo que aqui se fija es la otra mitad: la columna, que es la via para dar el
// panel a quien NO es administrador.

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
       FROM portal.visores_kpis_log ORDER BY id`,
  );
  return rows as Record<string, unknown>[];
}

describe('fijarVisorDeKpis', () => {
  it('concede el permiso: la ficha queda en true y el log gana una fila', async () => {
    expect(await fijarVisorDeKpis(db, ADMIN, empleadoId, true)).toBe(true);
    expect(await esVisorDeKpis(db, CORREO)).toBe(true);

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
    // El log es un historial, no un espejo del estado actual: el panel ensena
    // el pasivo de vacaciones de la plantilla entera, y reconstruir quien pudo
    // verlo en una fecha dada exige las dos lecturas.
    await fijarVisorDeKpis(db, ADMIN, empleadoId, true);
    expect(await fijarVisorDeKpis(db, ADMIN, empleadoId, false)).toBe(true);
    expect(await esVisorDeKpis(db, CORREO)).toBe(false);

    const filas = await log();
    expect(filas).toHaveLength(2);
    expect(filas[0].concedido).toBe(true);
    expect(filas[1]).toMatchObject({ concedido: false, empleado_correo: CORREO });
  });

  it('un id inexistente no toca nada: false, y ni una fila en el log', async () => {
    const fantasma = '00000000-0000-4000-8000-000000000000';
    expect(await fijarVisorDeKpis(db, ADMIN, fantasma, true)).toBe(false);
    expect(await log()).toHaveLength(0);
  });

  it('una ficha inactiva tampoco: false, y el intento no ensucia el log', async () => {
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    expect(await fijarVisorDeKpis(db, ADMIN, empleadoId, true)).toBe(false);
    expect(await log()).toHaveLength(0);
  });
});

describe('esVisorDeKpis', () => {
  it('false para quien no tiene el permiso marcado', async () => {
    expect(await esVisorDeKpis(db, CORREO)).toBe(false);
  });

  it('CANDADO: un ex-empleado con el permiso puesto ya no ve nada', async () => {
    // El `AND activo` de la LECTURA. Sin el, quien se fue de la compania sigue
    // abriendo el panel que ensena el pasivo de vacaciones agregado y el
    // desglose de tiempos de aprobacion por aprobador.
    await fijarVisorDeKpis(db, ADMIN, empleadoId, true);
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    expect(await esVisorDeKpis(db, CORREO)).toBe(false);
  });

  it('el correo se compara sin distinguir mayusculas, como el resto de la app', async () => {
    await fijarVisorDeKpis(db, ADMIN, empleadoId, true);
    expect(await esVisorDeKpis(db, CORREO.toUpperCase())).toBe(true);
  });

  it('false para un correo que no es de nadie', async () => {
    expect(await esVisorDeKpis(db, 'nadie@ambientalia.com.co')).toBe(false);
  });
});

describe('empleadoPorId: veKpis viaja en la ficha', () => {
  // Candado del cableado de `COLS_EMPLEADO` / `aEmpleado()`: la pestana
  // Organigrama no puede pintar la casilla si la ficha que lee el repo no trae
  // el campo, aunque la columna SQL exista y `esVisorDeKpis` la lea bien.
  it('trae veKpis en true justo despues de concederlo', async () => {
    await fijarVisorDeKpis(db, ADMIN, empleadoId, true);
    const ficha = await empleadoPorId(db, empleadoId);
    expect(ficha?.veKpis).toBe(true);
  });

  it('trae veKpis en false justo despues de quitarlo', async () => {
    await fijarVisorDeKpis(db, ADMIN, empleadoId, true);
    await fijarVisorDeKpis(db, ADMIN, empleadoId, false);
    const ficha = await empleadoPorId(db, empleadoId);
    expect(ficha?.veKpis).toBe(false);
  });

  it('CANDADO: conceder esta llave no toca las otras tres de la fila', async () => {
    // Las cuatro viven en la misma fila de `portal.empleados`. Un UPDATE que se
    // llevara por delante `ve_adjuntos` daria los PDF medicos a quien solo pidio
    // los KPIs, o -al reves- se los quitaria a administracion sin que nadie se
    // enterara hasta el dia que hiciera falta abrir uno.
    await db.query(
      `UPDATE portal.empleados
          SET ve_adjuntos = TRUE, exporta_registro = TRUE, ve_toda_la_empresa = TRUE
        WHERE id = $1`,
      [empleadoId],
    );
    await fijarVisorDeKpis(db, ADMIN, empleadoId, true);
    const ficha = await empleadoPorId(db, empleadoId);
    expect(ficha?.veAdjuntos).toBe(true);
    expect(ficha?.exportaRegistro).toBe(true);
    expect(ficha?.veTodaLaEmpresa).toBe(true);
    expect(ficha?.veKpis).toBe(true);
  });

  it('CANDADO: las otras tres llaves no encienden esta', async () => {
    // El reverso del anterior: si un dia alguien metiera `ve_kpis` dentro del
    // UPDATE de otra llave, el panel se abriria para gente que solo pidio
    // exportar el registro o ver el calendario de la empresa.
    await db.query(
      `UPDATE portal.empleados
          SET ve_adjuntos = TRUE, exporta_registro = TRUE, ve_toda_la_empresa = TRUE
        WHERE id = $1`,
      [empleadoId],
    );
    const ficha = await empleadoPorId(db, empleadoId);
    expect(ficha?.veKpis).toBe(false);
    expect(await esVisorDeKpis(db, CORREO)).toBe(false);
  });
});
