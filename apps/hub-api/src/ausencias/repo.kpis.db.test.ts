import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { decisionesParaKpi, pendientesParaKpi } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// Las dos consultas que alimentan el panel de KPIs, contra Postgres de verdad.
//
// Van contra el motor real y no contra un doble porque lo que se prueba AQUI
// son los recortes del WHERE, que es donde estan los errores caros: una fila de
// mas o de menos no rompe nada visible, solo desplaza una mediana que gerencia
// va a leer como si fuera un hecho.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const DESDE = '2020-01-01T00:00:00Z';

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

/** Una solicitud con sus dos marcas de tiempo puestas a mano. */
async function sembrar(
  estado: 'pendiente' | 'pendiente_2' | 'aprobada' | 'rechazada' | 'registrada',
  createdAt: string,
  decididaAt: string | null,
  aprobadorCorreo = 'jefe1@ambientalia.com.co',
): Promise<void> {
  const s = await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo: null,
    tipo: estado === 'registrada' ? 'incapacidad' : 'vacaciones',
  });
  // `crearSolicitud` pone `created_at` a NOW() y no acepta fechas: para medir
  // duraciones hay que fijarlas despues, y por SQL directo a proposito -asi el
  // fixture no depende de que el repo exponga un camino que produccion no usa.
  await db.query(
    `UPDATE portal.solicitudes_ausencia
        SET created_at = $2::timestamptz, decidida_at = $3::timestamptz, aprobador_correo = $4
      WHERE id = $1`,
    [s.id, createdAt, decididaAt, aprobadorCorreo],
  );
}

describe('decisionesParaKpi', () => {
  it('trae las decididas con su aprobador y sus dos marcas de tiempo', async () => {
    await sembrar('aprobada', '2026-09-01T08:00:00Z', '2026-09-01T12:00:00Z');
    const filas = await decisionesParaKpi(db, DESDE);

    expect(filas).toHaveLength(1);
    expect(filas[0].aprobadorCorreo).toBe('jefe1@ambientalia.com.co');
    expect(Date.parse(filas[0].decididaAt!) - Date.parse(filas[0].createdAt)).toBe(4 * 3_600_000);
  });

  it('las rechazadas cuentan igual que las aprobadas', async () => {
    // Rechazar tambien es decidir, y hacerlo rapido tambien es atender la
    // bandeja. Contar solo las aprobadas premiaria a quien dice que si.
    await sembrar('rechazada', '2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z');
    expect(await decisionesParaKpi(db, DESDE)).toHaveLength(1);
  });

  it('CANDADO: las que aun esperan firma no salen', async () => {
    await sembrar('pendiente', '2026-09-01T08:00:00Z', null);
    await sembrar('pendiente_2', '2026-09-01T08:00:00Z', null);
    expect(await decisionesParaKpi(db, DESDE)).toEqual([]);
  });

  it('CANDADO: las `registrada` del historico importado NO entran', async () => {
    // Son las filas que trajo la hoja de Google: nadie las decidio en esta app,
    // asi que su `decidida_at` -si algun dia se rellenara- no mide el tiempo de
    // nadie. Colarlas inventaria un tiempo de aprobacion para un aprobador que
    // jamas vio esa solicitud.
    await sembrar('registrada', '2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z');
    expect(await decisionesParaKpi(db, DESDE)).toEqual([]);
  });

  it('CANDADO: la ventana temporal recorta por `created_at`', async () => {
    // Sin el recorte, el panel arrastraria para siempre el historico entero y
    // la mediana de este trimestre quedaria sepultada bajo la de hace tres
    // anos, que es justo lo que nadie quiere mirar.
    await sembrar('aprobada', '2024-01-01T08:00:00Z', '2024-01-01T09:00:00Z');
    await sembrar('aprobada', '2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z');
    const filas = await decisionesParaKpi(db, '2026-01-01T00:00:00Z');
    expect(filas).toHaveLength(1);
    expect(filas[0].createdAt).toContain('2026-09-01');
  });

  it('sin decisiones, lista vacia', async () => {
    expect(await decisionesParaKpi(db, DESDE)).toEqual([]);
  });
});

describe('pendientesParaKpi', () => {
  it('trae las dos formas de estar pendiente: primera y segunda firma', async () => {
    // `pendiente_2` espera igual que `pendiente`, y a quien la pidio le da lo
    // mismo en que escalon se haya parado. Contar solo la primera esconderia
    // justo las que llevan mas tiempo dando vueltas.
    await sembrar('pendiente', '2026-09-01T08:00:00Z', null);
    await sembrar('pendiente_2', '2026-09-02T08:00:00Z', null);
    expect(await pendientesParaKpi(db)).toHaveLength(2);
  });

  it('CANDADO: las ya decididas no esperan a nadie', async () => {
    await sembrar('aprobada', '2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z');
    await sembrar('rechazada', '2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z');
    expect(await pendientesParaKpi(db)).toEqual([]);
  });

  it('CANDADO: las `registrada` tampoco, aunque no tengan decision', async () => {
    // Trampa real: una `registrada` no tiene `decidida_at`, asi que un WHERE
    // escrito como «decidida_at IS NULL» en vez de por estado se las tragaria
    // TODAS y el panel diria que hay cientos de solicitudes esperando firma.
    await sembrar('registrada', '2026-09-01T08:00:00Z', null);
    expect(await pendientesParaKpi(db)).toEqual([]);
  });

  it('trae el `created_at` para poder repartirlas por antiguedad', async () => {
    await sembrar('pendiente', '2026-09-01T08:00:00Z', null);
    const filas = await pendientesParaKpi(db);
    expect(filas[0].createdAt).toContain('2026-09-01');
  });

  it('sin pendientes, lista vacia', async () => {
    expect(await pendientesParaKpi(db)).toEqual([]);
  });
});
